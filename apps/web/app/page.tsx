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
import { BrandMark } from "@/components/brand-mark";
import { brand } from "@/lib/brand";

const flow = [
  {
    n: "01",
    title: "Create one payment link",
    body: "Set the order, amount, and expiry. A deterministic vault is reserved for the invoice on Arc.",
  },
  {
    n: "02",
    title: "Let the customer choose",
    body: "The payer reviews a live quote and sends native USDC from Base Sepolia or Ethereum Sepolia.",
  },
  {
    n: "03",
    title: "Settle and reconcile",
    body: "Circle CCTP routes the transfer to the invoice vault. Permissionless settlement and signed webhooks close the loop.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero shell">
        <div className="hero-copy-column">
          <div className="eyebrow">
            <span className="live-dot" />
            Crosschain USDC checkout
          </div>
          <h1>
            Accept USDC across chains.
            <span> Settle in one place.</span>
          </h1>
          <p className="hero-copy">
            {brand.productName} gives merchants one payment link while customers
            pay from a supported chain. Every completed payment settles into a
            dedicated invoice vault on Arc.
          </p>
          <div className="hero-actions">
            <Link href="/proof" className="button primary">
              View Proof of Build <ArrowRight size={17} />
            </Link>
            <Link href="/proof#contracts" className="button secondary">
              Explore deployed contracts
            </Link>
          </div>
          <div className="infrastructure-line" aria-label="Infrastructure">
            <span>{brand.infrastructureAttribution}</span>
            <span aria-hidden="true">·</span>
            <span>{brand.protocolAttribution}</span>
          </div>
        </div>

        <div className="checkout-preview" aria-label="Example checkout">
          <div className="preview-brand">
            <span className="brand compact">
              <BrandMark className="brand-mark" />
              {brand.productName}
            </span>
            <span className="pill open">Open · 48:12</span>
          </div>
          <div className="preview-top">
            <div>
              <span className="micro">PAYMENT REQUEST</span>
              <strong>Northstar Supply</strong>
            </div>
          </div>
          <div className="preview-amount">
            <span>Amount due</span>
            <strong>
              125.00 <small>USDC</small>
            </strong>
          </div>
          <div className="route-card">
            <div className="chain-icon base">B</div>
            <div>
              <span>Pay from</span>
              <strong>Base Sepolia</strong>
            </div>
            <ArrowRight />
            <div className="chain-icon destination">S</div>
            <div>
              <span>Settle on</span>
              <strong>Arc Testnet</strong>
            </div>
          </div>
          <div className="quote-row">
            <span>Estimated source total</span>
            <strong>125.063 USDC</strong>
          </div>
          <button type="button">Review and pay</button>
          <p>Crosschain transfer via Circle CCTP · final settlement on Arc</p>
        </div>
      </section>

      <section className="network-strip" aria-label="Supported testnet routes">
        <span>SUPPORTED TESTNET ROUTES</span>
        <div>
          <b className="chain-icon base">B</b>Base Sepolia
        </div>
        <div>
          <b className="chain-icon eth">E</b>Ethereum Sepolia
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <b className="chain-icon destination">S</b>Arc Testnet
          <em>Settlement</em>
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-kicker">HOW IT WORKS</div>
        <div className="section-heading">
          <h2>Crosschain complexity stays behind the link.</h2>
          <p>
            No wrapped balance or merchant-operated bridge. Native USDC moves
            through Circle CCTP into the invoice’s settlement vault.
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

      <section className="feature-band" id="infrastructure">
        <div className="shell feature-grid">
          <div>
            <div className="section-kicker light">
              SETTLEMENT INFRASTRUCTURE
            </div>
            <h2>Why final settlement happens on Arc.</h2>
            <p>
              Each invoice has a deterministic Arc vault that anchors payout,
              reconciliation, timeout refunds, and verifiable receipt evidence.
              The destination stays consistent even when the payer’s source
              chain changes.
            </p>
            <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
              Explore Arc documentation <ExternalLink size={15} />
            </a>
          </div>
          <div className="metric-stack">
            <div>
              <span>Settlement asset</span>
              <strong>USDC</strong>
              <small>Native destination liquidity</small>
            </div>
            <div>
              <span>Route protocol</span>
              <strong>CCTP V2</strong>
              <small>Circle infrastructure</small>
            </div>
            <div>
              <span>Vault identity</span>
              <strong>CREATE2</strong>
              <small>One address per invoice</small>
            </div>
          </div>
        </div>
      </section>

      <section className="section shell" id="developers">
        <div className="section-heading">
          <div>
            <div className="section-kicker">MERCHANT OPERATIONS</div>
            <h2>Designed for payments, not speculation.</h2>
          </div>
        </div>
        <div className="feature-cards">
          <article>
            <Link2 />
            <h3>Payment links and QR</h3>
            <p>Share an exact amount, expiry, and onchain destination.</p>
          </article>
          <article>
            <Boxes />
            <h3>Deterministic vaults</h3>
            <p>Keep each order’s funds and evidence clearly separated.</p>
          </article>
          <article>
            <WalletCards />
            <h3>Signed webhooks</h3>
            <p>Reconcile lifecycle events with retries and delivery logs.</p>
          </article>
        </div>
        <div className="trust-row feature-trust">
          <span>
            <ShieldCheck size={16} /> Non-custodial vaults
          </span>
          <span>
            <Radio size={16} /> Recoverable transfer state
          </span>
          <span>
            <BadgeCheck size={16} /> Onchain source of truth
          </span>
        </div>
        <div className="final-cta">
          <div>
            <span className="section-kicker">PUBLIC BUILDER PREVIEW</span>
            <h2>
              Verify the contracts, configuration, and transaction evidence.
            </h2>
          </div>
          <Link href="/proof" className="button primary">
            View Proof of Build <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </>
  );
}
