"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { WalletButton } from "@/components/wallet-button";
import { apiFetch, compactAddress } from "@/lib/api";
import { ensureMerchantSession } from "@/lib/merchant-auth";

type TransactionView = { hash: string; url: string } | null;
type Dashboard = {
  merchant: {
    name: string | null;
    walletAddress: string;
    payoutAddress: string;
    payoutExplorer: { address: string; url: string } | null;
  };
  metrics: {
    totalInvoices: number;
    settledVolume: string;
    statusCounts: Record<string, number>;
  };
  sourceChainDistribution: Array<{
    chainId: number;
    name: string;
    attempts: number;
  }>;
  invoices: Array<{
    id: string;
    slug: string;
    orderId: string;
    amount: string;
    fundedAmount: string;
    status: string;
    customerAddress: string | null;
    refundAddress: string | null;
    sourceChain: { chainId: number; name: string } | null;
    sourceTransaction: TransactionView;
    cctpStatus: string | null;
    arcMintTransaction: TransactionView;
    settlementTransaction: TransactionView;
    webhookDelivery: {
      status: string;
      attempts: number;
      lastError: string | null;
    } | null;
    updatedAt: string;
  }>;
  recentAttempts: Array<{
    id: string;
    invoiceSlug: string;
    orderId: string;
    status: string;
    customerAddress: string;
    refundAddress: string | null;
    sourceChain: { chainId: number; name: string };
    sourceTransaction: TransactionView;
    arcMintTransaction: TransactionView;
    updatedAt: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const statusOptions = [
  "",
  "OPEN",
  "PARTIALLY_FUNDED",
  "FUNDED",
  "SETTLING",
  "SETTLED",
  "CANCELLED",
  "REFUNDED",
  "EXPIRED",
] as const;

function ExplorerLink({ transaction }: { transaction: TransactionView }) {
  if (!transaction) return <span className="muted-value">Pending</span>;
  return (
    <a
      className="tx-link"
      href={transaction.url}
      target="_blank"
      rel="noreferrer"
    >
      {compactAddress(transaction.hash)} <ArrowUpRight size={11} />
    </a>
  );
}

export function DashboardClient() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState("");
  const [sourceChainId, setSourceChainId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!address || !isConnected) {
      setDashboard(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        await ensureMerchantSession(address, (message) =>
          signMessageAsync({ message }),
        );
        const query = new URLSearchParams({
          merchantAddress: address,
          page: page.toString(),
          pageSize: "20",
        });
        if (status) query.set("status", status);
        if (sourceChainId) query.set("sourceChainId", sourceChainId);
        if (search) query.set("search", search);
        const loaded = await apiFetch<Dashboard>(`/api/dashboard?${query}`);
        if (!cancelled) setDashboard(loaded);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Dashboard could not be loaded",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    address,
    isConnected,
    page,
    refreshKey,
    search,
    signMessageAsync,
    sourceChainId,
    status,
  ]);

  if (!isConnected || !address)
    return (
      <div className="page-shell">
        <div className="card empty-state">
          <div className="section-kicker">MERCHANT OVERVIEW</div>
          <h1 className="page-title">Connect your merchant wallet.</h1>
          <p className="page-subtitle">
            Dashboard data is scoped to the wallet that signs the SettleLink
            merchant session. Settlement records are verified against Arc.
          </p>
          <WalletButton />
        </div>
      </div>
    );

  const counts = dashboard?.metrics.statusCounts ?? {};
  return (
    <div className="page-shell dashboard-page">
      <div className="section-heading">
        <div>
          <div className="section-kicker">MERCHANT OVERVIEW</div>
          <h1 className="page-title">
            {dashboard?.merchant.name ?? "Your SettleLink checkout"}
          </h1>
          <p className="page-subtitle">
            Payout{" "}
            {compactAddress(dashboard?.merchant.payoutAddress ?? address)}
          </p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={15} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link href="/invoices/new" className="button primary">
            <Plus size={16} /> New invoice
          </Link>
        </div>
      </div>

      {error && (
        <div className="message error dashboard-message" role="alert">
          {error}
        </div>
      )}
      {loading && !dashboard && (
        <div className="dashboard-loading" aria-live="polite">
          Loading authenticated merchant data…
        </div>
      )}

      {dashboard && (
        <>
          <div className="stats-grid dashboard-stats">
            <div className="stat">
              <span>SETTLED VOLUME</span>
              <strong>{dashboard.metrics.settledVolume} USDC</strong>
            </div>
            <div className="stat">
              <span>TOTAL INVOICES</span>
              <strong>{dashboard.metrics.totalInvoices}</strong>
            </div>
            <div className="stat">
              <span>OPEN / PARTIAL</span>
              <strong>
                {(counts.OPEN ?? 0) + (counts.PARTIALLY_FUNDED ?? 0)}
              </strong>
            </div>
            <div className="stat">
              <span>FUNDED / SETTLED</span>
              <strong>{(counts.FUNDED ?? 0) + (counts.SETTLED ?? 0)}</strong>
            </div>
            <div className="stat compact-stat">
              <span>CANCELLED</span>
              <strong>{counts.CANCELLED ?? 0}</strong>
            </div>
            <div className="stat compact-stat">
              <span>REFUNDED</span>
              <strong>{counts.REFUNDED ?? 0}</strong>
            </div>
          </div>

          <div className="dashboard-grid">
            <section className="card">
              <div className="card-heading">
                <div>
                  <div className="section-kicker">SOURCE DISTRIBUTION</div>
                  <h2>Submitted burns</h2>
                </div>
              </div>
              {dashboard.sourceChainDistribution.length === 0 ? (
                <p className="empty-copy">No verified source burns yet.</p>
              ) : (
                <div className="distribution-list">
                  {dashboard.sourceChainDistribution.map((source) => (
                    <div key={source.chainId}>
                      <span>{source.name}</span>
                      <strong>{source.attempts}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="card">
              <div className="section-kicker">RECENT ATTEMPTS</div>
              <h2>Customer activity</h2>
              {dashboard.recentAttempts.length === 0 ? (
                <p className="empty-copy">No payment attempts yet.</p>
              ) : (
                <div className="attempt-list">
                  {dashboard.recentAttempts.slice(0, 5).map((attempt) => (
                    <Link
                      key={attempt.id}
                      href={`/pay/${encodeURIComponent(attempt.invoiceSlug)}`}
                    >
                      <span>
                        {attempt.orderId} · {attempt.sourceChain.name}
                      </span>
                      <strong>{attempt.status}</strong>
                      <small>
                        {compactAddress(attempt.customerAddress)} → refund{" "}
                        {compactAddress(attempt.refundAddress)}
                      </small>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <form
            className="dashboard-filters card"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            <label>
              <span>Search</span>
              <div className="search-field">
                <Search size={14} />
                <input
                  aria-label="Search invoices"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Order, slug, or customer"
                />
              </div>
            </label>
            <label>
              <span>Status</span>
              <select
                aria-label="Filter by invoice status"
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
              >
                {statusOptions.map((option) => (
                  <option key={option || "all"} value={option}>
                    {option || "All statuses"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source</span>
              <select
                aria-label="Filter by source chain"
                value={sourceChainId}
                onChange={(event) => {
                  setPage(1);
                  setSourceChainId(event.target.value);
                }}
              >
                <option value="">All sources</option>
                <option value="84532">Base Sepolia</option>
                <option value="11155111">Ethereum Sepolia</option>
              </select>
            </label>
            <button className="button secondary" type="submit">
              Apply
            </button>
          </form>

          <div className="table-card dashboard-table">
            <div className="table-head">
              <span>Order / customer</span>
              <span>Source / CCTP</span>
              <span>Amount</span>
              <span>Transactions</span>
              <span>Webhook / status</span>
            </div>
            {dashboard.invoices.length === 0 ? (
              <div className="empty-state table-empty">
                No invoices match these filters.
              </div>
            ) : (
              dashboard.invoices.map((invoice) => (
                <div className="table-row" key={invoice.id}>
                  <div className="table-stack">
                    <Link
                      href={`/receipts/${encodeURIComponent(invoice.slug)}`}
                    >
                      <strong>{invoice.orderId}</strong>
                    </Link>
                    <small>{compactAddress(invoice.customerAddress)}</small>
                    <small>
                      Refund {compactAddress(invoice.refundAddress)}
                    </small>
                  </div>
                  <div className="table-stack">
                    <strong>
                      {invoice.sourceChain?.name ?? "Not started"}
                    </strong>
                    <small>{invoice.cctpStatus ?? "No attempt"}</small>
                    <ExplorerLink transaction={invoice.sourceTransaction} />
                  </div>
                  <div className="table-stack">
                    <strong>{invoice.amount} USDC</strong>
                    <small>Funded {invoice.fundedAmount}</small>
                  </div>
                  <div className="table-stack">
                    <span>
                      Mint{" "}
                      <ExplorerLink transaction={invoice.arcMintTransaction} />
                    </span>
                    <span>
                      Settle{" "}
                      <ExplorerLink
                        transaction={invoice.settlementTransaction}
                      />
                    </span>
                  </div>
                  <div className="table-stack">
                    <span
                      className={`status-badge ${invoice.status === "OPEN" ? "pending" : ""}`}
                    >
                      {invoice.status}
                    </span>
                    <small>
                      Webhook{" "}
                      {invoice.webhookDelivery?.status ?? "not subscribed"}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pagination-bar">
            <span>
              Page {dashboard.pagination.page} of{" "}
              {dashboard.pagination.totalPages || 1} ·{" "}
              {dashboard.pagination.total} invoices
            </span>
            <div className="button-row">
              <button
                className="button secondary small-button"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ArrowLeft size={14} /> Previous
              </button>
              <button
                className="button secondary small-button"
                type="button"
                disabled={
                  loading ||
                  page >= Math.max(1, dashboard.pagination.totalPages)
                }
                onClick={() => setPage((value) => value + 1)}
              >
                Next <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
