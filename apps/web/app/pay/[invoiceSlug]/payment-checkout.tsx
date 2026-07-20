"use client";

import { useEffect, useMemo, useState } from "react";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import type { EIP1193Provider } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { apiFetch, compactAddress } from "@/lib/api";
import { paymentVaultAbi } from "@/lib/contracts";
import { WalletButton } from "@/components/wallet-button";

type Invoice = {
  id: string;
  slug: string;
  orderId: string;
  amount: string;
  funded: string;
  description?: string;
  expiresAt: string;
  vaultAddress?: string;
  status: string;
  mode: string;
  merchant: { displayName?: string; payoutAddress: string };
};
type Quote = {
  totalSourceAmount: string;
  protocolFeeSubunits: string;
  forwardFeeSubunits: string;
  feeBufferSubunits: string;
  expiresAt: string;
  vaultAddress: string;
  quoteSource: string;
};
const steps = [
  "Invoice loaded",
  "Wallet connected",
  "USDC approval",
  "USDC burned on source chain",
  "Circle attestation",
  "USDC minted to Arc vault",
  "Invoice finalized on Arc",
  "Merchant paid",
];

export function PaymentCheckout({ invoiceSlug }: { invoiceSlug: string }) {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [sourceChainId, setSourceChainId] = useState<number>(baseSepolia.id);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = useMemo(
    () => `arc-checkout-progress:${invoiceSlug}`,
    [invoiceSlug],
  );

  useEffect(() => {
    apiFetch<Invoice>(`/api/payment-intents/${encodeURIComponent(invoiceSlug)}`)
      .then((loaded) => {
        setInvoice(loaded);
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const value = JSON.parse(saved) as { step?: number };
            if (
              Number.isInteger(value.step) &&
              (value.step ?? 0) >= 1 &&
              (value.step ?? 0) <= steps.length
            )
              setActiveStep(value.step!);
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Invoice could not be loaded",
        ),
      );
  }, [invoiceSlug, storageKey]);
  useEffect(() => {
    if (isConnected) setActiveStep((step) => Math.max(step, 2));
  }, [isConnected]);

  async function loadQuote() {
    if (!invoice) return;
    setBusy(true);
    setError("");
    try {
      setQuote(
        await apiFetch<Quote>(`/api/payment-intents/${invoice.id}/quote`, {
          method: "POST",
          body: JSON.stringify({ sourceChainId }),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Circle quote failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function saveStep(step: number, extra: object = {}) {
    setActiveStep(step);
    localStorage.setItem(
      storageKey,
      JSON.stringify({ step, ...extra, updatedAt: new Date().toISOString() }),
    );
  }

  async function pay() {
    if (!invoice?.vaultAddress || !quote || !connector || !address) return;
    if (invoice.mode === "demo") {
      setError(
        "Use the labeled local state-machine demo instead of submitting a fake bridge.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (chainId !== sourceChainId)
        await switchChainAsync({
          chainId: sourceChainId,
        });
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter = await createViemAdapterFromProvider({ provider });
      const kit = new AppKit();
      kit.on("bridge.approve", () => saveStep(3));
      kit.on("bridge.burn", (payload) =>
        saveStep(4, { burnTxHash: payload.values.txHash }),
      );
      kit.on("bridge.fetchAttestation", () => saveStep(5));
      kit.on("bridge.mint", (payload) =>
        saveStep(6, { mintTxHash: payload.values.txHash }),
      );
      const result = await kit.bridge({
        from: {
          adapter,
          chain:
            sourceChainId === baseSepolia.id
              ? "Base_Sepolia"
              : "Ethereum_Sepolia",
        },
        to: {
          recipientAddress: invoice.vaultAddress,
          chain: "Arc_Testnet",
          useForwarder: true,
        },
        amount: quote.totalSourceAmount,
      });
      const burn = result.steps.find((step) => step.name === "burn");
      await apiFetch(`/api/payment-intents/${invoice.id}/attempts`, {
        method: "POST",
        body: JSON.stringify({
          sourceChainId,
          customerAddress: address,
          quotedSourceAmount: quote.totalSourceAmount,
          sourceTransactionHash: burn?.txHash,
        }),
      });
      if (result.state !== "success")
        throw new Error(
          "The transfer is pending or needs recovery. Your completed steps were saved.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Payment could not be completed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function simulateDemo() {
    if (!invoice || !address) return;
    setBusy(true);
    setError("");
    try {
      const attempt = await apiFetch<{ id: string }>(
        `/api/payment-intents/${invoice.id}/attempts`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceChainId,
            customerAddress: address,
            quotedSourceAmount: quote?.totalSourceAmount ?? invoice.amount,
          }),
        },
      );
      const statusToStep: Record<string, number> = {
        QUOTED: 2,
        APPROVING: 3,
        BURN_SUBMITTED: 4,
        SOURCE_CONFIRMED: 4,
        ATTESTING: 5,
        ARC_MINTED: 6,
        SETTLING: 7,
        SETTLED: 8,
      };
      const poll = window.setInterval(() => {
        void apiFetch<{ status: string }>(`/api/payment-attempts/${attempt.id}`)
          .then((current) => {
            saveStep(statusToStep[current.status] ?? 2, { localDemo: true });
            if (current.status === "SETTLED" || current.status === "FAILED") {
              window.clearInterval(poll);
              setBusy(false);
            }
          })
          .catch(() => {
            window.clearInterval(poll);
            setBusy(false);
          });
      }, 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local demo failed");
      setBusy(false);
    }
  }

  async function finalize() {
    if (!invoice?.vaultAddress || invoice.mode === "demo") return;
    setBusy(true);
    setError("");
    try {
      if (chainId !== arcTestnet.id)
        await switchChainAsync({ chainId: arcTestnet.id });
      const hash = await writeContractAsync({
        address: invoice.vaultAddress as `0x${string}`,
        abi: paymentVaultAbi,
        functionName: "settle",
        chainId: arcTestnet.id,
      });
      saveStep(7, { settlementTxHash: hash });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  if (!invoice)
    return (
      <div className="page-shell">
        <div className="card">{error || "Loading verified invoice…"}</div>
      </div>
    );
  return (
    <div className="page-shell">
      <div className="pay-layout">
        <section className="card invoice-card">
          <div className="merchant-line">
            <div>
              <div className="section-kicker">PAYMENT REQUEST</div>
              <h1>{invoice.merchant.displayName ?? "Arc merchant"}</h1>
            </div>
            <span
              className={`status-badge ${invoice.status === "OPEN" ? "pending" : ""}`}
            >
              {invoice.status}
            </span>
          </div>
          {invoice.mode === "demo" && (
            <div className="demo-banner">
              Local demo invoice — it exercises the same lifecycle and never
              emits fake blockchain hashes.
            </div>
          )}
          <div className="amount-due">
            <span>Amount due</span>
            <strong>
              {invoice.amount} <small>USDC</small>
            </strong>
            <p>{invoice.description}</p>
          </div>
          <div className="details-list">
            <div>
              <span>Order reference</span>
              <strong>{invoice.orderId}</strong>
            </div>
            <div>
              <span>Destination network</span>
              <strong>Arc Testnet</strong>
            </div>
            <div>
              <span>Invoice vault</span>
              <strong className="tx-link">
                {compactAddress(invoice.vaultAddress)}
              </strong>
            </div>
            <div>
              <span>Expires</span>
              <strong>{new Date(invoice.expiresAt).toLocaleString()}</strong>
            </div>
            <div>
              <span>Refunds</span>
              <strong>Arc address only (MVP)</strong>
            </div>
          </div>
          <div className="payment-actions">
            <WalletButton />
            <div className="chain-choice">
              <button
                className={sourceChainId === baseSepolia.id ? "selected" : ""}
                onClick={() => {
                  setSourceChainId(baseSepolia.id);
                  setQuote(null);
                }}
              >
                Base Sepolia
              </button>
              <button
                className={sourceChainId === sepolia.id ? "selected" : ""}
                onClick={() => {
                  setSourceChainId(sepolia.id);
                  setQuote(null);
                }}
              >
                Ethereum Sepolia
              </button>
            </div>
            {!quote ? (
              <button
                className="button primary"
                disabled={!isConnected || busy}
                onClick={() => {
                  void loadQuote();
                }}
              >
                {busy ? "Getting quote…" : "Review fees"}
              </button>
            ) : (
              <>
                <div className="quote-box">
                  <div>
                    <span>Merchant receives</span>
                    <strong>{invoice.amount} USDC</strong>
                  </div>
                  <div>
                    <span>CCTP protocol fee</span>
                    <strong>
                      {Number(quote.protocolFeeSubunits) / 1e6} USDC
                    </strong>
                  </div>
                  <div>
                    <span>Forwarding + safety buffer</span>
                    <strong>
                      {(Number(quote.forwardFeeSubunits) +
                        Number(quote.feeBufferSubunits)) /
                        1e6}{" "}
                      USDC
                    </strong>
                  </div>
                  <div>
                    <span>Total source spend</span>
                    <strong>{quote.totalSourceAmount} USDC</strong>
                  </div>
                  <div>
                    <span>Quote source</span>
                    <strong>{quote.quoteSource}</strong>
                  </div>
                </div>
                {invoice.mode === "demo" ? (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      void simulateDemo();
                    }}
                  >
                    {busy
                      ? "Running local lifecycle…"
                      : "Run local state-machine demo"}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      void pay();
                    }}
                  >
                    {busy
                      ? "Payment in progress…"
                      : `Pay ${quote.totalSourceAmount} USDC`}
                  </button>
                )}
              </>
            )}
            {activeStep >= 6 && activeStep < 7 && invoice.mode !== "demo" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  void finalize();
                }}
              >
                Finalize on Arc
              </button>
            )}
            {error && <div className="message error">{error}</div>}
          </div>
        </section>
        <aside className="card">
          <div className="section-kicker">PAYMENT PROGRESS</div>
          <h2>Track every hop</h2>
          <ol className="timeline">
            {steps.map((step, index) => (
              <li key={step} className={index + 1 <= activeStep ? "done" : ""}>
                {step}
              </li>
            ))}
          </ol>
          <p className="page-subtitle">
            Attestation delays are recoverable. Progress is saved on this device
            without storing wallet credentials.
          </p>
        </aside>
      </div>
    </div>
  );
}
