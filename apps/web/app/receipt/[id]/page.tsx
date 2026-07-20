import { Check, ExternalLink } from "lucide-react";
import { compactAddress } from "@/lib/api";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="page-shell receipt">
      <div className="card">
        <div className="receipt-header">
          <div>
            <div className="section-kicker">PAYMENT RECEIPT</div>
            <h1 className="page-title">125.00 USDC paid</h1>
            <p className="page-subtitle">Receipt {id}</p>
          </div>
          <span className="receipt-check">
            <Check />
          </span>
        </div>
        <div className="demo-banner">
          Example receipt layout. Real hashes appear only after the indexer
          confirms Arc settlement.
        </div>
        <div className="details-list">
          <div>
            <span>Merchant</span>
            <strong>Northstar Supply</strong>
          </div>
          <div>
            <span>Order</span>
            <strong>DEMO-1042</strong>
          </div>
          <div>
            <span>Source network</span>
            <strong>Base Sepolia</strong>
          </div>
          <div>
            <span>Source transaction</span>
            <strong>{compactAddress(null)}</strong>
          </div>
          <div>
            <span>CCTP transfer ID</span>
            <strong>{compactAddress(null)}</strong>
          </div>
          <div>
            <span>Arc mint transaction</span>
            <strong>{compactAddress(null)}</strong>
          </div>
          <div>
            <span>Arc settlement transaction</span>
            <strong>{compactAddress(null)}</strong>
          </div>
          <div>
            <span>Final status</span>
            <span className="status-badge">Awaiting real testnet payment</span>
          </div>
        </div>
        <button className="button secondary" onClick={undefined}>
          Print receipt <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
