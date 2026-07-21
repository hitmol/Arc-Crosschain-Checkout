"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { useAccount, useChainId, usePublicClient, useSwitchChain } from "wagmi";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { ARC_EXPLORER, GITHUB_REPOSITORY } from "@/lib/deployment";
import {
  formatInvoiceAmount,
  invoicePath,
  readLocalInvoices,
  type LocalInvoice,
} from "@/lib/onchain-invoices";
import {
  isRegisteredMerchant,
  readMerchant,
  readVaultSnapshot,
  recoverPendingInvoices,
  type MerchantRecord,
} from "@/lib/onchain-runtime";

const stateLabels = [
  "Open",
  "Partially funded",
  "Funded",
  "Settled",
  "Refunded",
  "Cancelled",
];

export function PublicBuilderConsole() {
  const account = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [merchant, setMerchant] = useState<MerchantRecord | null>(null);
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [vaultStates, setVaultStates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const address = account.address ? getAddress(account.address) : null;

  const refresh = useCallback(async () => {
    if (!publicClient || typeof window === "undefined") return;
    setLoading(true);
    setError("");
    try {
      const recovered = await recoverPendingInvoices(
        publicClient,
        window.localStorage,
      );
      const scoped = address
        ? recovered.filter(
            (invoice) =>
              invoice.merchant.toLowerCase() === address.toLowerCase(),
          )
        : readLocalInvoices(window.localStorage);
      setInvoices(scoped);
      if (address) setMerchant(await readMerchant(publicClient, address));
      const nextStates: Record<string, string> = {};
      await Promise.all(
        scoped.map(async (invoice) => {
          if (!invoice.vault || invoice.status !== "confirmed") return;
          try {
            const snapshot = await readVaultSnapshot(
              publicClient,
              invoice.vault,
            );
            nextStates[invoice.orderId] =
              stateLabels[snapshot.paymentState] ??
              `State ${snapshot.paymentState}`;
          } catch {
            nextStates[invoice.orderId] = "RPC unavailable";
          }
        }),
      );
      setVaultStates(nextStates);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Arc data could not be refreshed",
      );
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const registered = Boolean(
    address && merchant && isRegisteredMerchant(merchant, address),
  );

  return (
    <div className="page-shell builder-console">
      <div className="section-heading">
        <div>
          <div className="section-kicker">PUBLIC ONCHAIN MODE</div>
          <h1 className="page-title">Arc Testnet Builder Console</h1>
          <p className="page-subtitle">
            Create and recover real Arc invoices without a merchant API account.
          </p>
        </div>
        <Link className="button primary" href="/invoices/new">
          <Plus size={16} /> Create Invoice
        </Link>
      </div>

      <div className="builder-console-grid">
        <section className="card">
          <div className="section-kicker">WALLET</div>
          <h2>{account.isConnected ? "Connected" : "Not connected"}</h2>
          <WalletButton />
          {address && <p className="break-address">{address}</p>}
          <p>
            Network:{" "}
            {chainId === arcTestnet.id ? "Arc Testnet" : `Chain ${chainId}`}
          </p>
          {account.isConnected && chainId !== arcTestnet.id && (
            <button
              className="button secondary"
              disabled={switching}
              onClick={() => void switchChainAsync({ chainId: arcTestnet.id })}
              type="button"
            >
              Switch to Arc Testnet
            </button>
          )}
        </section>
        <section className="card">
          <div className="section-kicker">MERCHANT</div>
          <h2>{registered ? "Active merchant" : "Registration required"}</h2>
          {registered && merchant ? (
            <div className="details-list">
              <div>
                <span>Payout</span>
                <strong>{merchant.payoutAddress}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong className="proof-ok">Active</strong>
              </div>
            </div>
          ) : (
            <p>
              Register this wallet through MerchantRegistry before creating an
              invoice.
            </p>
          )}
          <Link className="button secondary" href="/invoices/new">
            {registered ? "Create Invoice" : "Register merchant"}
          </Link>
        </section>
        <section className="card builder-actions">
          <div className="section-kicker">ACTIONS</div>
          <h2>Public verification</h2>
          <Link href="/proof">View Proof of Build</Link>
          <Link href="/proof#contracts">Explore deployed contracts</Link>
          <Link href="/docs">Read documentation</Link>
          <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">
            View GitHub <ExternalLink size={13} />
          </a>
        </section>
      </div>

      <section
        className="card browser-history"
        aria-labelledby="browser-history-heading"
      >
        <div className="card-heading">
          <div>
            <div className="section-kicker">LOCAL PUBLIC DATA</div>
            <h2 id="browser-history-heading">
              Invoices created from this browser
            </h2>
          </div>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={loading ? "spin" : ""} size={15} /> Refresh
            from Arc
          </button>
        </div>
        <p className="field-hint">
          This is not a complete merchant account history. Every displayed state
          is refreshed from Arc when a vault is known.
        </p>
        {invoices.length === 0 ? (
          <div className="empty-state">No invoices from this browser yet.</div>
        ) : (
          <div className="history-list">
            {invoices.map((invoice) => (
              <article key={`${invoice.merchant}:${invoice.orderId}`}>
                <div>
                  <Link href={invoicePath(invoice)}>
                    <strong>{invoice.orderReference}</strong>
                  </Link>
                  <small>
                    {formatInvoiceAmount(invoice.amountUnits)} USDC ·{" "}
                    {new Date(invoice.createdAt).toLocaleString()}
                  </small>
                </div>
                <div>
                  <span>Status</span>
                  <strong>
                    {invoice.status === "confirmed"
                      ? (vaultStates[invoice.orderId] ?? "Confirmed")
                      : invoice.status}
                  </strong>
                </div>
                <div>
                  <span>Vault</span>
                  <strong>{invoice.vault ?? invoice.predictedVault}</strong>
                </div>
                <a
                  href={`${ARC_EXPLORER}/tx/${invoice.creationTransaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction <ExternalLink size={12} />
                </a>
              </article>
            ))}
          </div>
        )}
      </section>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <div className="public-mode-notice">
        The production merchant API and worker are not enabled on this public
        builder preview. Onchain invoice creation remains available.
      </div>
    </div>
  );
}
