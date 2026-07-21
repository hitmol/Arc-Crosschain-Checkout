import { brand } from "@/lib/brand";

export default function DocsPage() {
  return (
    <div className="page-shell docs-grid">
      <nav className="docs-nav" aria-label="Documentation sections">
        <a href="#overview">Overview</a>
        <a href="#evidence">Evidence</a>
        <a href="#flow">Payment flow</a>
        <a href="#sdk">SDK</a>
        <a href="#webhooks">Webhooks</a>
        <a href="#security">Security</a>
      </nav>
      <article className="docs-content">
        <div className="section-kicker">{brand.productName} DEVELOPER DOCS</div>
        <h1 className="page-title" id="overview">
          One invoice, one settlement vault.
        </h1>
        <p>
          {brand.productName} creates a deterministic EIP-1167 vault on Arc for
          each invoice. Circle CCTP V2 forwards native USDC from Base Sepolia or
          Ethereum Sepolia directly to that vault.
        </p>
        <p className="infrastructure-callout">
          <strong>{brand.infrastructureAttribution}.</strong> Arc provides the
          destination settlement layer; it is not the product brand or operator.
        </p>
        <h2 id="evidence">Public verification</h2>
        <p>
          The public builder preview operates in read-only mode when no live API
          URL is configured. Its <a href="/proof">Proof of Build</a> page parses
          the RPC-verified Arc deployment record and successful transaction
          receipts; unavailable interactions are explicitly marked as not yet
          recorded.
        </p>
        <h2 id="flow">Payment flow</h2>
        <ol>
          <li>Create the payment intent and its deterministic Arc vault.</li>
          <li>Fetch a fresh Circle forwarding fee quote.</li>
          <li>Approve and burn native source-chain USDC.</li>
          <li>Wait for Circle to forward the Arc mint.</li>
          <li>Call the permissionless vault settlement function.</li>
          <li>Confirm contract state, then emit a signed webhook.</li>
        </ol>
        <h2 id="sdk">TypeScript SDK</h2>
        <p>
          The legacy class and package scope remain for source compatibility in
          this release; the public product name is {brand.productName}.
        </p>
        <pre className="code-block">{`import { ArcCheckout } from "@arc-checkout/sdk";

const settleLink = new ArcCheckout({
  apiUrl: process.env.SETTLELINK_API_URL!,
  apiKey: process.env.SETTLELINK_API_KEY,
});

const invoice = await settleLink.paymentIntents.create({
  merchantAddress: "0x...",
  orderId: "ORDER-1042",
  amount: "100.00",
  expiresInSeconds: 3600,
});`}</pre>
        <h2 id="webhooks">Webhook verification</h2>
        <p>
          Verify <code>x-arc-timestamp</code> is within five minutes, then
          compute HMAC-SHA256 over <code>timestamp.rawBody</code>. The header is
          retained for API compatibility and refers to the settlement network.
        </p>
        <h2 id="security">Security boundary</h2>
        <p>
          The database is an index and cache. If database state conflicts with
          the vault, the Arc contract wins. Admin pause only affects new invoice
          creation and cannot block settlement or timeout refunds.
        </p>
      </article>
    </div>
  );
}
