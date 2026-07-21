"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Hash,
} from "viem";
import { arcTestnet } from "viem/chains";
import { usePublicClient } from "wagmi";
import { ExternalLink, RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { orderIdToBytes32 } from "@arc-checkout/shared";
import { checkoutFactoryAbi } from "@/lib/contracts";
import { ARC_EXPLORER, arcDeployment } from "@/lib/deployment";
import { readLocalInvoices, type LocalInvoice } from "@/lib/onchain-invoices";
import {
  factoryAddress,
  readVaultSnapshot,
  recoverPendingInvoices,
  type VaultSnapshot,
} from "@/lib/onchain-runtime";

const stateLabels = [
  "Open",
  "Partially funded",
  "Funded",
  "Settled",
  "Refunded",
  "Cancelled",
];

export function OnchainInvoiceView({
  merchant,
  orderReference,
}: {
  merchant: string;
  orderReference: string;
}) {
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const [record, setRecord] = useState<LocalInvoice | null>(null);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [creationTransaction, setCreationTransaction] = useState<Hash | null>(
    null,
  );
  const [paymentUrl, setPaymentUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const merchantAddress = isAddress(merchant, { strict: false })
    ? getAddress(merchant)
    : null;

  const refresh = useCallback(async () => {
    if (!publicClient || !merchantAddress) {
      setError("The merchant address in this invoice URL is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (typeof window !== "undefined")
        await recoverPendingInvoices(publicClient, window.localStorage);
      const local =
        typeof window === "undefined"
          ? []
          : readLocalInvoices(window.localStorage);
      const orderId = orderIdToBytes32(orderReference);
      const localRecord = local.find(
        (entry) =>
          entry.merchant.toLowerCase() === merchantAddress.toLowerCase() &&
          entry.orderId.toLowerCase() === orderId.toLowerCase(),
      );
      setRecord(localRecord ?? null);
      const vault = getAddress(
        String(
          await publicClient.readContract({
            address: factoryAddress,
            abi: checkoutFactoryAbi,
            functionName: "vaultByOrderId",
            args: [merchantAddress, orderId],
          }),
        ),
      );
      if (vault === zeroAddress) {
        setSnapshot(null);
        if (localRecord?.status === "pending") return;
        throw new Error(
          "No Arc invoice exists for this merchant and order ID.",
        );
      }
      const loaded = await readVaultSnapshot(publicClient, vault);
      if (loaded.merchant.toLowerCase() !== merchantAddress.toLowerCase())
        throw new Error("Invoice vault merchant does not match this URL.");
      if (loaded.orderId.toLowerCase() !== orderId.toLowerCase())
        throw new Error("Invoice vault order ID does not match this URL.");
      setSnapshot(loaded);
      if (localRecord?.creationTransaction) {
        setCreationTransaction(localRecord.creationTransaction as Hash);
      } else {
        const events = await publicClient.getContractEvents({
          address: factoryAddress,
          abi: checkoutFactoryAbi,
          eventName: "PaymentIntentCreated",
          args: { orderId, merchant: merchantAddress },
          fromBlock: BigInt(arcDeployment.deploymentBlock),
          toBlock: "latest",
        });
        setCreationTransaction(events.at(-1)?.transactionHash ?? null);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Invoice could not be loaded from Arc",
      );
    } finally {
      setLoading(false);
    }
  }, [merchantAddress, orderReference, publicClient]);

  useEffect(() => {
    setPaymentUrl(window.location.href);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="page-shell invoice-view-page">
      <div className="section-heading">
        <div>
          <div className="section-kicker">ARC TESTNET INVOICE</div>
          <h1 className="page-title">
            {snapshot
              ? "Invoice created"
              : loading
                ? "Loading invoice…"
                : "Invoice unavailable"}
          </h1>
          <p className="page-subtitle">
            Onchain values are read directly from the deterministic
            PaymentVault.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCw className={loading ? "spin" : ""} size={15} /> Refresh from
          Arc
        </button>
      </div>

      {snapshot && (
        <section className="card invoice-success-card">
          <div className="details-list">
            <div>
              <span>Status</span>
              <strong className="proof-ok">
                {stateLabels[snapshot.paymentState] ??
                  `State ${snapshot.paymentState}`}
              </strong>
            </div>
            <div>
              <span>Merchant</span>
              <strong>{snapshot.merchant}</strong>
            </div>
            <div>
              <span>Order ID</span>
              <strong>{orderReference}</strong>
            </div>
            <div>
              <span>Vault</span>
              <strong>{snapshot.vault}</strong>
              <CopyButton label="Vault address" value={snapshot.vault} />
            </div>
            <div>
              <span>Expected amount</span>
              <strong>{formatUnits(snapshot.expectedAmount, 6)} USDC</strong>
            </div>
            <div>
              <span>Amount received</span>
              <strong>{formatUnits(snapshot.currentBalance, 6)} USDC</strong>
            </div>
            <div>
              <span>Payout address</span>
              <strong>{snapshot.payoutAddress}</strong>
            </div>
            <div>
              <span>Expiry</span>
              <strong>
                {new Date(Number(snapshot.expiresAt) * 1_000).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Refund address</span>
              <strong>
                {snapshot.refundAddress === zeroAddress
                  ? "Authorized by payer when payment begins"
                  : snapshot.refundAddress}
              </strong>
            </div>
            <div>
              <span>Creation transaction</span>
              <strong>{creationTransaction ?? "Locating event…"}</strong>
              {creationTransaction && (
                <CopyButton
                  label="Creation transaction hash"
                  value={creationTransaction}
                />
              )}
            </div>
          </div>
          <div className="button-row">
            {paymentUrl && (
              <CopyButton label="Payment URL" value={paymentUrl} />
            )}
            {paymentUrl && (
              <button
                className="button secondary"
                onClick={() => void navigator.clipboard.writeText(paymentUrl)}
                type="button"
              >
                Copy payment link
              </button>
            )}
            <a
              className="button secondary"
              href={`${ARC_EXPLORER}/address/${snapshot.vault}`}
              target="_blank"
              rel="noreferrer"
            >
              Open vault <ExternalLink size={13} />
            </a>
            {creationTransaction && (
              <a
                className="button secondary"
                href={`${ARC_EXPLORER}/tx/${creationTransaction}`}
                target="_blank"
                rel="noreferrer"
              >
                Open transaction <ExternalLink size={13} />
              </a>
            )}
            <Link className="button primary" href="/invoices/new">
              Create another invoice
            </Link>
          </div>
        </section>
      )}

      {!snapshot && record?.status === "pending" && !error && (
        <div className="message success" role="status">
          Invoice creation is still confirming. Transaction{" "}
          {record.creationTransaction}.
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <div className="public-mode-notice">
        This builder-preview invoice can be funded directly on Arc Testnet after
        the payer registers an authorization. The public CCTP payment route is
        still being validated; direct Arc funding is not CCTP evidence.
      </div>
    </div>
  );
}
