import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ExternalLink,
  Link2,
  Radio,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

const flow = [
  {
    n: "01",
    title: "Create on Arc",
    body: "A merchant creates a USDC invoice. The factory deploys a unique deterministic vault on Arc.",
  },
  {
    n: "02",
    title: "Pay from any supported chain",
    body: "The customer reviews a live Circle fee quote and pays from Base Sepolia or Ethereum Sepolia.",
  },
  {
    n: "03",
    title: "Settle and reconcile",
    body: "CCTP mints native USDC to the vault. Anyone can finalize payout; signed webhooks close the loop.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero shell">
        <div className="eyebrow">
          <span className="live-dot" />
          Built for Arc programmable money
        </div>
        <h1>
          One payment link.
          <br />
          <span>Every USDC chain.</span>
          <br />
          Settlement on Arc.
        </h1>
        <p className="hero-copy">
          Accept native USDC from customers across chains without asking them to
          bridge. Every payment arrives in a unique Arc invoice vault and
          reconciles itself.
        </p>
        <div className="hero-actions">
          <Link href="/invoices/new" className="button primary">
            Create a testnet invoice <ArrowRight size={17} />
          </Link>
          <Link href="/pay/demo-1042" className="button secondary">
            Open working demo
          </Link>
        </div>
        <div className="trust-row">
          <span>
            <ShieldCheck size={16} />
            Non-custodial vaults
          </span>
          <span>
            <Radio size={16} />
            CCTP V2 forwarding
          </span>
          <span>
            <BadgeCheck size={16} />
            Onchain source of truth
          </span>
        </div>
        <div className="checkout-preview">
          <div className="preview-top">
            <div>
              <span className="micro">INVOICE</span>
              <strong>Northstar Supply</strong>
            </div>
            <span className="pill open">Open · 48:12</span>
          </div>
          <div className="preview-amount">
            <span>Amount due</span>
            <strong>
              $125.00 <small>USDC</small>
            </strong>
          </div>
          <div className="route-card">
            <div className="chain-icon base">B</div>
            <div>
              <span>Pay from</span>
              <strong>Base Sepolia</strong>
            </div>
            <ArrowRight />
            <div className="chain-icon arc">A</div>
            <div>
              <span>Settle to</span>
              <strong>Arc Testnet</strong>
            </div>
          </div>
          <div className="quote-row">
            <span>Circle network fee</span>
            <strong>0.063 USDC</strong>
          </div>
          <button>Pay 125.063 USDC</button>
          <p>
            <span className="lock">◆</span> Funds mint directly to invoice vault{" "}
            <code>0x2D8…8A2c</code>
          </p>
        </div>
      </section>
      <section className="network-strip">
        <span>SUPPORTED TESTNET ROUTES</span>
        <div>
          <b className="chain-icon base">B</b>Base Sepolia
        </div>
        <div>
          <b className="chain-icon eth">Ξ</b>Ethereum Sepolia
        </div>
        <ArrowRight />
        <div>
          <b className="chain-icon arc">A</b>Arc Testnet <em>Settlement</em>
        </div>
      </section>
      <section className="section shell">
        <div className="section-kicker">THE CHECKOUT RAIL</div>
        <div className="section-heading">
          <h2>
            Crosschain complexity stays
            <br />
            behind the payment link.
          </h2>
          <p>
            No custom bridge, wrapped token, or custodial balance. Circle burns
            USDC on the source chain and mints native USDC into the invoice
            vault on Arc.
          </p>
        </div>
        <div className="flow-grid">
          {flow.map((item) => (
            <article key={item.n}>
              <span>{item.n}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="feature-band">
        <div className="shell feature-grid">
          <div>
            <div className="section-kicker light">WHY ARC</div>
            <h2>
              A stablecoin-native settlement layer changes the checkout math.
            </h2>
            <p>
              Payment value, application accounting, and destination gas are all
              denominated in USDC. Merchants receive consistent Arc liquidity
              regardless of where the customer started.
            </p>
            <a
              href="https://docs.arc.io/arc/concepts/stable-fee-design"
              target="_blank"
              rel="noreferrer"
            >
              Read the Arc fee model <ExternalLink size={15} />
            </a>
          </div>
          <div className="metric-stack">
            <div>
              <span>Destination gas</span>
              <strong>USDC</strong>
              <small>No volatile gas asset</small>
            </div>
            <div>
              <span>Finality</span>
              <strong>&lt; 1 sec</strong>
              <small>Deterministic settlement</small>
            </div>
            <div>
              <span>Vault identity</span>
              <strong>CREATE2</strong>
              <small>One address per invoice</small>
            </div>
          </div>
        </div>
      </section>
      <section className="section shell">
        <div className="section-heading">
          <div>
            <div className="section-kicker">MERCHANT OPERATIONS</div>
            <h2>
              Built for reconciliation,
              <br />
              not speculation.
            </h2>
          </div>
        </div>
        <div className="feature-cards">
          <article>
            <Link2 />
            <h3>Payment links & QR</h3>
            <p>
              Share a stable public URL with an exact amount, expiry, and
              onchain Arc destination.
            </p>
          </article>
          <article>
            <Boxes />
            <h3>Deterministic vaults</h3>
            <p>
              The destination address is computed before deployment and
              permanently tied to the invoice.
            </p>
          </article>
          <article>
            <WalletCards />
            <h3>Signed webhooks</h3>
            <p>
              HMAC-signed lifecycle events with retries, delivery logs, and
              replay-resistant timestamps.
            </p>
          </article>
        </div>
        <div className="final-cta">
          <div>
            <span className="section-kicker">TESTNET READY</span>
            <h2>Turn an order into an Arc-settled invoice.</h2>
          </div>
          <Link href="/onboarding" className="button primary">
            Start merchant setup <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </>
  );
}
