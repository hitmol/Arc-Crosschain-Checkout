"use client";

import { Check, Clock3, Download, ExternalLink, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { compactAddress } from "@/lib/api";
import { brand } from "@/lib/brand";
import type {
  AddressView,
  TransactionView,
  VerifiedReceipt,
} from "./receipt-types";

function valueOrPending(value?: string | number | null) {
  return value === null || value === undefined || value === ""
    ? "Pending / unavailable"
    : String(value);
}

function dateOrPending(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Pending / unavailable";
}

function addressValue(
  label: string,
  view: AddressView,
  fallback?: string | null,
) {
  const value = view?.address ?? fallback ?? null;
  if (!value) return <span className="muted-value">Pending / unavailable</span>;
  return (
    <span className="receipt-linked-value">
      {view ? (
        <a href={view.url} rel="noreferrer" target="_blank">
          {compactAddress(value)} <ExternalLink size={12} />
        </a>
      ) : (
        <span>{compactAddress(value)}</span>
      )}
      <CopyButton label={label} value={value} />
    </span>
  );
}

function transactionValue(label: string, transaction: TransactionView) {
  if (!transaction)
    return <span className="muted-value">Pending / unavailable</span>;
  return (
    <span className="receipt-linked-value">
      <a href={transaction.url} rel="noreferrer" target="_blank">
        {compactAddress(transaction.hash)} <ExternalLink size={12} />
      </a>
      <CopyButton label={label} value={transaction.hash} />
    </span>
  );
}

export function ReceiptView({ receipt }: { receipt: VerifiedReceipt }) {
  const settled = receipt.invoice.status === "SETTLED";
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: "Merchant",
      value: receipt.merchant.name ?? receipt.merchant.walletAddress,
    },
    {
      label: "Merchant wallet",
      value: addressValue(
        "merchant wallet",
        null,
        receipt.merchant.walletAddress,
      ),
    },
    {
      label: "Payout address",
      value: addressValue(
        "payout address",
        receipt.merchant.payoutExplorer,
        receipt.merchant.payoutAddress,
      ),
    },
    {
      label: "Order",
      value: receipt.invoice.orderId,
    },
    {
      label: "Invoice vault",
      value: addressValue("invoice vault", receipt.invoice.vault),
    },
    {
      label: "Invoice amount",
      value: `${receipt.invoice.amount} USDC`,
    },
    {
      label: "Funded amount",
      value: `${receipt.invoice.fundedAmount} USDC`,
    },
    {
      label: "Invoice status",
      value: receipt.invoice.status,
    },
    {
      label: "Customer",
      value: addressValue(
        "customer wallet",
        null,
        receipt.customer?.walletAddress,
      ),
    },
    {
      label: "Refund address",
      value: addressValue(
        "refund address",
        null,
        receipt.customer?.arcRefundAddress,
      ),
    },
    {
      label: "Source network",
      value: valueOrPending(receipt.source?.network.name),
    },
    {
      label: "Customer source total",
      value: receipt.source ? `${receipt.source.totalAmount} USDC` : null,
    },
    {
      label: "Circle protocol fee",
      value: receipt.source?.circleProtocolFee
        ? `${receipt.source.circleProtocolFee} USDC`
        : null,
    },
    {
      label: "Forwarding fee",
      value: receipt.source?.forwardingFee
        ? `${receipt.source.forwardingFee} USDC`
        : null,
    },
    {
      label: "Protocol / project fee",
      value: receipt.arc.treasuryFee ? `${receipt.arc.treasuryFee} USDC` : null,
    },
    {
      label: "Source burn",
      value: transactionValue(
        "source burn transaction",
        receipt.source?.burnTransaction ?? null,
      ),
    },
    {
      label: "CCTP message hash",
      value: receipt.cctp?.messageHash ? (
        <span className="receipt-linked-value">
          <code>{compactAddress(receipt.cctp.messageHash)}</code>
          <CopyButton
            label="CCTP message hash"
            value={receipt.cctp.messageHash}
          />
        </span>
      ) : null,
    },
    {
      label: "CCTP event nonce",
      value: valueOrPending(receipt.cctp?.eventNonce),
    },
    {
      label: "CCTP / attestation",
      value: receipt.cctp
        ? `${receipt.cctp.status} · ${
            receipt.cctp.attestationReceived ? "received" : "pending"
          }`
        : null,
    },
    {
      label: "Arc mint",
      value: transactionValue(
        "Arc mint transaction",
        receipt.arc.mintTransaction,
      ),
    },
    {
      label: "Arc settlement",
      value: transactionValue(
        "Arc settlement transaction",
        receipt.arc.settlementTransaction,
      ),
    },
    {
      label: "Merchant payout",
      value: receipt.arc.merchantPayout
        ? `${receipt.arc.merchantPayout} USDC`
        : null,
    },
    {
      label: "Excess",
      value: receipt.arc.excessAmount
        ? `${receipt.arc.excessAmount} USDC`
        : null,
    },
    {
      label: "Refunded",
      value: receipt.arc.refundedAmount
        ? `${receipt.arc.refundedAmount} USDC`
        : null,
    },
    {
      label: "Invoice created",
      value: dateOrPending(receipt.timestamps.invoiceCreatedAt),
    },
    {
      label: "Payment attempt created",
      value: dateOrPending(receipt.timestamps.attemptCreatedAt),
    },
    {
      label: "Payment attempt updated",
      value: dateOrPending(receipt.timestamps.attemptUpdatedAt),
    },
    {
      label: "Settled",
      value: dateOrPending(receipt.timestamps.settledAt),
    },
    {
      label: "Last verified update",
      value: dateOrPending(receipt.timestamps.lastUpdatedAt),
    },
  ];

  function downloadJson() {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `settlelink-receipt-${receipt.invoice.slug}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-shell receipt">
      <article className="card receipt-card">
        <header className="receipt-header">
          <div>
            <div className="section-kicker">
              {brand.productName.toUpperCase()} PAYMENT RECEIPT
            </div>
            <h1 className="page-title">
              {receipt.invoice.amount} USDC · {receipt.invoice.status}
            </h1>
            <p className="page-subtitle">
              Order {receipt.invoice.orderId} · receipt v
              {receipt.receiptVersion}
            </p>
            <p className="receipt-attribution">
              Crosschain transfer via Circle CCTP · final settlement on Arc
            </p>
          </div>
          <span className={`receipt-check ${settled ? "" : "pending"}`}>
            {settled ? <Check /> : <Clock3 />}
          </span>
        </header>

        <div className="receipt-verification">
          <strong>Verified evidence</strong>
          {receipt.verifiedFrom.length > 0 ? (
            <div className="receipt-tags">
              {receipt.verifiedFrom.map((source) => (
                <span key={source}>{source}</span>
              ))}
            </div>
          ) : (
            <span className="muted-value">
              No finalized onchain evidence indexed yet.
            </span>
          )}
        </div>

        <div className="details-list receipt-details">
          {rows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value ?? "Pending / unavailable"}</strong>
            </div>
          ))}
        </div>

        {receipt.source?.gasNote && (
          <p className="receipt-note">{receipt.source.gasNote}</p>
        )}

        {receipt.evidence.length > 0 && (
          <section className="receipt-evidence">
            <div className="section-kicker">ARC EVENT EVIDENCE</div>
            {receipt.evidence.map((event) => (
              <div
                key={`${event.transaction?.hash ?? event.blockHash}:${event.logIndex}`}
              >
                <span>
                  {event.type} · block {event.blockNumber} · log{" "}
                  {event.logIndex}
                </span>
                {transactionValue("evidence transaction", event.transaction)}
              </div>
            ))}
          </section>
        )}

        <div className="button-row receipt-actions print-hidden">
          <button
            className="button secondary"
            onClick={() => window.print()}
            type="button"
          >
            <Printer size={15} /> Print
          </button>
          <button
            className="button secondary"
            onClick={downloadJson}
            type="button"
          >
            <Download size={15} /> Download JSON
          </button>
        </div>
      </article>
    </div>
  );
}
