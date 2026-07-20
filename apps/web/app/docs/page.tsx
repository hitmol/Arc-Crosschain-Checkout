export default function DocsPage() {
  return (
    <div className="page-shell docs-grid">
      <nav className="docs-nav">
        <a href="#overview">Overview</a>
        <a href="#flow">Payment flow</a>
        <a href="#sdk">SDK</a>
        <a href="#webhooks">Webhooks</a>
        <a href="#security">Security</a>
      </nav>
      <article className="docs-content">
        <div className="section-kicker">DEVELOPER DOCS</div>
        <h1 className="page-title" id="overview">
          One invoice, one Arc vault.
        </h1>
        <p>
          Arc Crosschain Checkout creates a deterministic EIP-1167 vault for
          each invoice. Circle CCTP V2 forwards native USDC from Base Sepolia or
          Ethereum Sepolia directly to that vault.
        </p>
        <h2 id="flow">Payment flow</h2>
        <ol>
          <li>
            Create the payment intent on Arc and persist its event in the index.
          </li>
          <li>Fetch a fresh Circle forwarding fee quote.</li>
          <li>Approve and burn native source-chain USDC.</li>
          <li>Wait for Circle to forward the Arc mint.</li>
          <li>Call the permissionless vault settlement function.</li>
          <li>Confirm contract state, then emit a signed webhook.</li>
        </ol>
        <h2 id="sdk">TypeScript SDK</h2>
        <pre className="code-block">{`import { ArcCheckout } from "@arc-checkout/sdk";

const checkout = new ArcCheckout({
  apiUrl: process.env.ARC_CHECKOUT_API_URL!,
  apiKey: process.env.ARC_CHECKOUT_API_KEY,
});

const invoice = await checkout.paymentIntents.create({
  merchantAddress: "0x...",
  orderId: "ORDER-1042",
  amount: "100.00",
  expiresInSeconds: 3600,
  refundAddress: "0x...",
});`}</pre>
        <h2 id="webhooks">Webhook verification</h2>
        <p>
          Verify `x-arc-timestamp` is within five minutes, then compute
          HMAC-SHA256 over `timestamp.rawBody`. Never reserialize JSON before
          verification.
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
