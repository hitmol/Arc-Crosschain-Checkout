import {
  enqueuePaymentWebhook,
  lifecycleWebhookEventId,
  prisma,
} from "@arc-checkout/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimWebhookDelivery,
  completeWebhookAttempt,
  recordWebhookAttemptStart,
  WEBHOOK_MAX_ATTEMPTS,
  webhookRetryDelayMs,
} from "./webhook-delivery.js";

const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;
const merchantAddress = "0x0000000000000000000000000000000000000b0b";
let intentId = "";

describeWithDatabase("transactional webhook outbox", () => {
  beforeAll(async () => {
    await prisma.merchant.deleteMany({
      where: { walletAddress: merchantAddress },
    });
    const merchant = await prisma.merchant.create({
      data: {
        walletAddress: merchantAddress,
        payoutAddress: merchantAddress,
        webhooks: {
          create: {
            url: "https://merchant.example/webhooks",
            encryptedSecret: "test-only",
            events: ["payment.source_confirmed", "payment.arc_minted"],
          },
        },
        intents: {
          create: {
            slug: "outbox-integration-test",
            orderId: "outbox-integration-test",
            orderIdBytes32:
              "0x000000000000000000000000006f7574626f782d696e746567726174696f6e",
            expectedAmount: 1_000_000n,
            payoutAddress: merchantAddress,
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          },
        },
      },
      include: { intents: true },
    });
    intentId = merchant.intents[0]!.id;
  });

  afterAll(async () => {
    await prisma.merchant.deleteMany({
      where: { walletAddress: merchantAddress },
    });
  });

  it("rolls state and event back together, then deduplicates a committed event", async () => {
    const intent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { id: intentId },
    });
    const eventId = lifecycleWebhookEventId({
      eventType: "payment.source_confirmed",
      identity:
        "84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await expect(
      prisma.$transaction(async (transaction) => {
        const updated = await transaction.paymentIntent.update({
          where: { id: intent.id },
          data: { status: "PARTIALLY_FUNDED" },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId,
          eventType: "payment.source_confirmed",
          intent: updated,
        });
        throw new Error("simulated worker crash before commit");
      }),
    ).rejects.toThrow("simulated worker crash");
    expect(
      await prisma.webhookEvent.findUnique({ where: { id: eventId } }),
    ).toBeNull();
    expect(
      (
        await prisma.paymentIntent.findUniqueOrThrow({
          where: { id: intent.id },
        })
      ).status,
    ).toBe("OPEN");

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.paymentIntent.update({
        where: { id: intent.id },
        data: { status: "PARTIALLY_FUNDED" },
      });
      await enqueuePaymentWebhook(transaction, {
        eventId,
        eventType: "payment.source_confirmed",
        intent: updated,
      });
      await enqueuePaymentWebhook(transaction, {
        eventId,
        eventType: "payment.source_confirmed",
        intent: updated,
      });
    });
    expect(await prisma.webhookEvent.count({ where: { id: eventId } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { eventId } })).toBe(1);
    await prisma.webhookDelivery.updateMany({
      where: { eventId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
  });

  it("keeps invoice order across retries, permanent failure and manual replay", async () => {
    const intent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { id: intentId },
    });
    const firstEventId = lifecycleWebhookEventId({
      eventType: "payment.source_confirmed",
      identity:
        "84532:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    const secondEventId = lifecycleWebhookEventId({
      eventType: "payment.arc_minted",
      identity:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    await prisma.$transaction(async (transaction) => {
      await enqueuePaymentWebhook(transaction, {
        eventId: firstEventId,
        eventType: "payment.source_confirmed",
        intent,
      });
      await enqueuePaymentWebhook(transaction, {
        eventId: secondEventId,
        eventType: "payment.arc_minted",
        intent,
      });
    });

    let clock = new Date("2031-01-01T00:00:00.000Z");
    const [winner, loser] = await Promise.all([
      claimWebhookDelivery(clock),
      claimWebhookDelivery(clock),
    ]);
    const first = winner ?? loser;
    expect(first?.event.id).toBe(firstEventId);
    expect([winner, loser].filter(Boolean)).toHaveLength(1);

    for (let retry = 1; retry <= WEBHOOK_MAX_ATTEMPTS; retry += 1) {
      const delivery = retry === 1 ? first! : await claimWebhookDelivery(clock);
      expect(delivery?.event.id).toBe(firstEventId);
      const attemptId = await recordWebhookAttemptStart(delivery!);
      await completeWebhookAttempt({
        delivery: delivery!,
        attemptId,
        responseStatus: 503,
        errorMessage: "HTTP 503",
        now: clock,
      });
      clock = new Date(
        clock.getTime() + webhookRetryDelayMs(delivery!.retryCount) + 1,
      );
    }

    const failed = await prisma.webhookDelivery.findUniqueOrThrow({
      where: {
        eventId_webhookEndpointId: {
          eventId: firstEventId,
          webhookEndpointId: first!.webhookEndpointId,
        },
      },
    });
    expect(failed.status).toBe("FAILED");
    expect(await claimWebhookDelivery(clock)).toBeNull();

    await prisma.webhookDelivery.update({
      where: { id: failed.id },
      data: {
        status: "PENDING",
        retryCount: 0,
        replayCount: { increment: 1 },
        nextAttemptAt: clock,
      },
    });
    const replay = await claimWebhookDelivery(clock);
    expect(replay?.event.id).toBe(firstEventId);
    const replayAttemptId = await recordWebhookAttemptStart(replay!);
    await completeWebhookAttempt({
      delivery: replay!,
      attemptId: replayAttemptId,
      responseStatus: 204,
      now: clock,
    });

    const second = await claimWebhookDelivery(clock);
    expect(second?.event.id).toBe(secondEventId);
    const secondAttemptId = await recordWebhookAttemptStart(second!);
    await completeWebhookAttempt({
      delivery: second!,
      attemptId: secondAttemptId,
      responseStatus: 200,
      now: clock,
    });
    expect(
      await prisma.webhookDeliveryAttempt.count({
        where: { webhookDeliveryId: failed.id },
      }),
    ).toBe(WEBHOOK_MAX_ATTEMPTS + 1);
    expect(
      await prisma.webhookDelivery.count({
        where: { event: { paymentIntentId: intentId }, status: "DELIVERED" },
      }),
    ).toBeGreaterThanOrEqual(2);
  });
});
