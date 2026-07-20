import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";

const invoices = [
  {
    order: "DEMO-1039",
    customer: "0x71D…A309",
    amount: "84.50",
    source: "Base Sepolia",
    status: "Settled",
    time: "18 min ago",
  },
  {
    order: "DEMO-1041",
    customer: "0xF22…19C0",
    amount: "220.00",
    source: "Ethereum Sepolia",
    status: "Settled",
    time: "1 hr ago",
  },
  {
    order: "DEMO-1042",
    customer: "—",
    amount: "125.00",
    source: "—",
    status: "Pending",
    time: "4 min ago",
  },
];

export default function DashboardPage() {
  return (
    <div className="page-shell">
      <div className="demo-banner">
        Local demo data — connect PostgreSQL and the Arc indexer to display only
        verified onchain payments.
      </div>
      <div className="section-heading">
        <div>
          <div className="section-kicker">MERCHANT OVERVIEW</div>
          <h1 className="page-title">Good afternoon, Northstar.</h1>
          <p className="page-subtitle">
            Arc-settled payment activity across every source chain.
          </p>
        </div>
        <Link href="/invoices/new" className="button primary">
          <Plus size={16} />
          New invoice
        </Link>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>SETTLED VOLUME</span>
          <strong>$304.50</strong>
        </div>
        <div className="stat">
          <span>TOTAL INVOICES</span>
          <strong>3</strong>
        </div>
        <div className="stat">
          <span>PAID</span>
          <strong>2</strong>
        </div>
        <div className="stat">
          <span>PENDING</span>
          <strong>1</strong>
        </div>
      </div>
      <div className="table-card">
        <div className="table-head">
          <span>Order</span>
          <span>Customer</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Updated</span>
        </div>
        {invoices.map((invoice) => (
          <div className="table-row" key={invoice.order}>
            <strong>{invoice.order}</strong>
            <span>{invoice.customer}</span>
            <span>{invoice.amount} USDC</span>
            <span
              className={`status-badge ${invoice.status === "Pending" ? "pending" : ""}`}
            >
              {invoice.status}
            </span>
            <span>
              {invoice.time} <ArrowUpRight size={12} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
