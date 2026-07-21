"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toBytes, zeroHash } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { arcTestnet } from "viem/chains";
import { parseUsdc, orderIdToBytes32 } from "@arc-checkout/shared";
import { apiFetch } from "@/lib/api";
import { ensureMerchantSession } from "@/lib/merchant-auth";
import { checkoutFactoryAbi } from "@/lib/contracts";
import { QRCodeSVG } from "qrcode.react";

const factoryAddress = process.env.NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS as
  `0x${string}` | undefined;

type Created = {
  paymentUrl: string;
  vaultAddress: string;
  createTransactionHash?: string;
  mode: string;
};

type PendingImport = {
  transactionHash: `0x${string}`;
  merchantAddress: `0x${string}`;
  orderId: string;
  amount: string;
  expiresAt: string;
  description?: string;
};

const pendingImportKey = "arc-checkout.pending-invoice-import";

export default function CreateInvoicePage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  const [form, setForm] = useState({
    orderId: "ORDER-1042",
    amount: "125.00",
    hours: "24",
    description: "Industrial sensor order #1042",
  });
  const expiresAt = useMemo(
    () => new Date(Date.now() + Number(form.hours || 1) * 3_600_000),
    [form.hours],
  );
  useEffect(() => {
    const stored = window.localStorage.getItem(pendingImportKey);
    if (!stored) return;
    try {
      setPendingImport(JSON.parse(stored) as PendingImport);
    } catch {
      window.localStorage.removeItem(pendingImportKey);
    }
  }, []);
  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function importConfirmedIntent(pending: PendingImport) {
    const payload = await apiFetch<Created>("/api/payment-intents/reconcile", {
      method: "POST",
      headers: { "idempotency-key": pending.transactionHash },
      body: JSON.stringify(pending),
    });
    window.localStorage.removeItem(pendingImportKey);
    setPendingImport(null);
    setCreated(payload);
  }

  async function recoverImport() {
    if (!pendingImport) return;
    setBusy(true);
    setError("");
    try {
      await ensureMerchantSession(pendingImport.merchantAddress, (message) =>
        signMessageAsync({ message }),
      );
      await importConfirmedIntent(pendingImport);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Invoice recovery failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!address) throw new Error("Connect the merchant wallet first");
      if (factoryAddress)
        await ensureMerchantSession(address, (message) =>
          signMessageAsync({ message }),
        );
      let createTransactionHash: string | undefined;
      if (factoryAddress) {
        if (chainId !== arcTestnet.id)
          await switchChainAsync({ chainId: arcTestnet.id });
        const orderIdBytes32 = orderIdToBytes32(form.orderId);
        createTransactionHash = await writeContractAsync({
          address: factoryAddress,
          abi: checkoutFactoryAbi,
          functionName: "createPaymentIntent",
          args: [
            orderIdBytes32,
            parseUsdc(form.amount),
            BigInt(Math.floor(expiresAt.getTime() / 1000)),
            form.description ? keccak256(toBytes(form.description)) : zeroHash,
          ],
          chainId: arcTestnet.id,
        });
        const receipt = await publicClient!.waitForTransactionReceipt({
          hash: createTransactionHash as `0x${string}`,
          confirmations: 1,
        });
        if (receipt.status !== "success")
          throw new Error("Arc transaction did not succeed");
        const pending: PendingImport = {
          transactionHash: createTransactionHash as `0x${string}`,
          merchantAddress: address,
          orderId: form.orderId,
          amount: form.amount,
          expiresAt: expiresAt.toISOString(),
          ...(form.description ? { description: form.description } : {}),
        };
        window.localStorage.setItem(pendingImportKey, JSON.stringify(pending));
        setPendingImport(pending);
        await importConfirmedIntent(pending);
        return;
      }
      const payload = await apiFetch<Created>("/api/payment-intents", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          merchantAddress: address,
          orderId: form.orderId,
          amount: form.amount,
          expiresAt: expiresAt.toISOString(),
          description: form.description,
        }),
      });
      setCreated(payload);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Invoice creation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <div className="page-shell">
        <div className="section-kicker">INVOICE CREATED</div>
        <h1 className="page-title">Payment link is ready.</h1>
        <div className="card">
          <div className="form-grid">
            <div>
              <QRCodeSVG value={created.paymentUrl} size={180} level="M" />
              <p className="page-subtitle">Scan to open checkout</p>
            </div>
            <div className="details-list">
              <div>
                <span>Mode</span>
                <strong>{created.mode}</strong>
              </div>
              <div>
                <span>Vault</span>
                <strong className="tx-link">{created.vaultAddress}</strong>
              </div>
              <div>
                <span>Payment link</span>
                <a className="tx-link" href={created.paymentUrl}>
                  {created.paymentUrl}
                </a>
              </div>
              {created.createTransactionHash && (
                <div>
                  <span>Arc transaction</span>
                  <strong className="tx-link">
                    {created.createTransactionHash}
                  </strong>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page-shell">
      <div className="section-kicker">NEW PAYMENT INTENT</div>
      <h1 className="page-title">Create a payment link.</h1>
      <p className="page-subtitle">
        Every invoice settles to a dedicated Arc vault. The payout address and
        protocol fee are locked at creation.
      </p>
      {!factoryAddress && (
        <div className="demo-banner">
          Local demo mode: the API creates a clearly labeled mock vault. Set the
          deployed factory address to create a real deterministic Arc vault.
        </div>
      )}
      {pendingImport && (
        <div className="message error">
          Arc confirmed transaction {pendingImport.transactionHash}, but the API
          import is still pending. Do not create another vault.
          <div className="form-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => void recoverImport()}
            >
              Retry verified import
            </button>
          </div>
        </div>
      )}
      <div className="card">
        <form
          className="form-grid"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <div className="field">
            <label htmlFor="orderId">Order reference</label>
            <input
              id="orderId"
              required
              maxLength={32}
              value={form.orderId}
              onChange={(event) => set("orderId", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="amount">Amount (USDC)</label>
            <input
              id="amount"
              required
              inputMode="decimal"
              pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?"
              value={form.amount}
              onChange={(event) => set("amount", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hours">Expires in</label>
            <select
              id="hours"
              value={form.hours}
              onChange={(event) => set("hours", event.target.value)}
            >
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
            </select>
          </div>
          <div className="field">
            <label>Customer refund address</label>
            <p className="field-hint">
              The customer signs and locks this address during checkout.
            </p>
          </div>
          <div className="field full">
            <label htmlFor="description">Customer-facing description</label>
            <textarea
              id="description"
              rows={3}
              maxLength={280}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <div className="field full form-actions">
            <button className="button primary" disabled={busy}>
              {busy
                ? "Creating…"
                : factoryAddress
                  ? "Create vault on Arc"
                  : "Create local demo invoice"}
            </button>
          </div>
        </form>
        {error && <div className="message error">{error}</div>}
      </div>
    </div>
  );
}
