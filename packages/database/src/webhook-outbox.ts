import type { Prisma } from "@prisma/client";

export const PAYMENT_WEBHOOK_EVENTS = [
  "payment.intent.created",
  "payment.attempt.created",
  "payment.source_submitted",
  "payment.source_confirmed",
  "payment.attestation_received",
  "payment.arc_minted",
  "payment.settled",
  "payment.cancelled",
  "payment.expired",
  "payment.refunded",
  "payment.excess_swept",
] as const;

export type PaymentWebhookEvent = (typeof PAYMENT_WEBHOOK_EVENTS)[number];

type OutboxIntent = {
  id: string;
  merchantId: string;
  orderId: string;
  expectedAmount: bigint;
  status: string;
  arcMintTransactionHash?: string | null;
  settlementTransactionHash?: string | null;
};

export function chainWebhookEventId(input: {
  eventType: PaymentWebhookEvent;
  chainId: number;
  transactionHash: string;
  logIndex: number;
}): string {
  return `${input.eventType}:${input.chainId}:${input.transactionHash.toLowerCase()}:${input.logIndex}`;
}

export function lifecycleWebhookEventId(input: {
  eventType: PaymentWebhookEvent;
  identity: string;
}): string {
  return `${input.eventType}:${input.identity.toLowerCase()}`;
}

export async function enqueuePaymentWebhook(
  transaction: Prisma.TransactionClient,
  input: {
    eventId: string;
    eventType: PaymentWebhookEvent;
    intent: OutboxIntent;
    data?: Prisma.InputJsonObject;
    occurredAt?: Date;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const payload: Prisma.InputJsonObject = {
    id: input.eventId,
    type: input.eventType,
    timestamp: occurredAt.toISOString(),
    merchantId: input.intent.merchantId,
    invoiceId: input.intent.id,
    orderId: input.intent.orderId,
    amount: input.intent.expectedAmount.toString(),
    finalStatus: input.intent.status,
    arcMintTransactionHash: input.intent.arcMintTransactionHash ?? null,
    settlementTransactionHash: input.intent.settlementTransactionHash ?? null,
    ...(input.data ?? {}),
  };
  const endpoints = await transaction.webhookEndpoint.findMany({
    where: {
      merchantId: input.intent.merchantId,
      active: true,
      events: { has: input.eventType },
    },
    select: { id: true },
  });
  await transaction.webhookEvent.upsert({
    where: { id: input.eventId },
    update: {},
    create: {
      id: input.eventId,
      eventType: input.eventType,
      payload,
      merchantId: input.intent.merchantId,
      paymentIntentId: input.intent.id,
    },
  });
  if (endpoints.length > 0) {
    await transaction.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        eventId: input.eventId,
        webhookEndpointId: endpoint.id,
      })),
      skipDuplicates: true,
    });
  }
}
