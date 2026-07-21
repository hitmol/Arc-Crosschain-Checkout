import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";

export function ReadOnlyNotice({ feature }: { feature: string }) {
  return (
    <div className="page-shell read-only-page">
      <div className="section-kicker">PUBLIC READ-ONLY MODE</div>
      <h1 className="page-title">{feature} is not enabled on this preview.</h1>
      <div className="read-only-card">
        <ShieldCheck size={24} />
        <div>
          <p>
            The merchant backend is not enabled on this public builder preview.
            Verified contract and transaction evidence remain available without
            authentication.
          </p>
          <div className="hero-actions">
            <Link href="/proof" className="button primary">
              View Proof of Build
            </Link>
            <Link href="/proof#contracts" className="button secondary">
              Explore contracts
            </Link>
            <a
              className="button secondary"
              href="https://github.com/hitmol/Arc-Crosschain-Checkout"
              target="_blank"
              rel="noreferrer"
            >
              View GitHub <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
