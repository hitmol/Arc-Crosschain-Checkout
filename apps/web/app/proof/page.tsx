import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import {
  ARC_EXPLORER,
  GITHUB_ACTIONS,
  GITHUB_REPOSITORY,
  PUBLIC_RELEASE_TAG,
  arcDeployment,
  interactionEvidence,
  projectContracts,
  proofTestInventory,
  verifiedExampleInvoice,
} from "@/lib/deployment";

export const metadata: Metadata = {
  title: "Proof of Build",
  description:
    "Verifiable SettleLink contracts, deployment, tests, and Arc Testnet evidence.",
};

function compact(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default function ProofPage() {
  return (
    <div className="proof-page shell">
      <section className="proof-hero">
        <div className="eyebrow">
          <span className="live-dot" /> Public verification package
        </div>
        <h1>Proof of Build</h1>
        <p>
          SettleLink is a crosschain USDC checkout built on Arc. This page is a
          read-only view of verified deployment data and recorded transactions;
          no wallet or backend login is required.
        </p>
        <div className="hero-actions">
          <a
            className="button primary"
            href={GITHUB_REPOSITORY}
            target="_blank"
            rel="noreferrer"
          >
            View source <ExternalLink size={16} />
          </a>
          <a
            className="button secondary"
            href={`${ARC_EXPLORER}/address/${arcDeployment.contracts.CheckoutFactory}`}
            target="_blank"
            rel="noreferrer"
          >
            Open ArcScan
          </a>
        </div>
      </section>

      <section className="proof-section" aria-labelledby="deployment-heading">
        <div className="section-kicker">VERIFIED DEPLOYMENT</div>
        <h2 id="deployment-heading">Arc Testnet deployment</h2>
        <div className="proof-facts">
          <div>
            <span>Network</span>
            <strong>Arc Testnet</strong>
          </div>
          <div>
            <span>Chain ID</span>
            <strong>{arcDeployment.chainId}</strong>
          </div>
          <div>
            <span>Deployment block</span>
            <strong>{arcDeployment.deploymentBlock}</strong>
          </div>
          <div>
            <span>Deployed</span>
            <strong>{new Date(arcDeployment.deployedAt).toISOString()}</strong>
          </div>
          <div>
            <span>Deployer</span>
            <strong>{compact(arcDeployment.deployer)}</strong>
            <CopyButton
              value={arcDeployment.deployer}
              label="Deployer address"
            />
          </div>
          <div>
            <span>Treasury</span>
            <strong>{compact(arcDeployment.treasury)}</strong>
            <CopyButton
              value={arcDeployment.treasury}
              label="Treasury address"
            />
          </div>
          <div>
            <span>Deployment commit</span>
            <a
              href={`${GITHUB_REPOSITORY}/commit/${arcDeployment.commit}`}
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch size={14} /> {arcDeployment.commit.slice(0, 12)}
            </a>
          </div>
          <div>
            <span>Builder release</span>
            <strong>{PUBLIC_RELEASE_TAG}</strong>
          </div>
          <div>
            <span>Source verification</span>
            <strong className="proof-ok">
              <CheckCircle2 size={15} /> Verified
            </strong>
          </div>
          <div>
            <span>Onchain configuration</span>
            <strong className="proof-ok">
              <CheckCircle2 size={15} /> RPC verified
            </strong>
          </div>
        </div>
      </section>

      <section
        className="proof-section"
        id="contracts"
        aria-labelledby="contracts-heading"
      >
        <div className="section-kicker">PROJECT-OWNED CONTRACTS</div>
        <h2 id="contracts-heading">Deployed contracts</h2>
        <p className="section-intro">
          Addresses and deployment transactions are parsed from the
          independently RPC-verified deployment record.
        </p>
        <div className="contract-grid">
          {projectContracts.map((contract) => (
            <article className="contract-card" key={contract.name}>
              <div className="contract-card-heading">
                <h3>{contract.name}</h3>
                <span className="status-badge">Verified</span>
              </div>
              <p>{contract.responsibility}</p>
              <code>{contract.address}</code>
              <div className="contract-actions">
                <CopyButton
                  value={contract.address}
                  label={`${contract.name} address`}
                />
                <a href={contract.addressUrl} target="_blank" rel="noreferrer">
                  Contract <ExternalLink size={13} />
                </a>
                <a
                  href={contract.transactionUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Deployment tx <ExternalLink size={13} />
                </a>
              </div>
            </article>
          ))}
        </div>
        <div className="factory-relations">
          <h3>CheckoutFactory relationships</h3>
          <dl>
            <div>
              <dt>MerchantRegistry</dt>
              <dd>{arcDeployment.contracts.MerchantRegistry}</dd>
            </div>
            <div>
              <dt>FeeManager</dt>
              <dd>{arcDeployment.contracts.FeeManager}</dd>
            </div>
            <div>
              <dt>Vault implementation</dt>
              <dd>{arcDeployment.contracts.PaymentVaultImplementation}</dd>
            </div>
            <div>
              <dt>Arc USDC interface</dt>
              <dd>{arcDeployment.usdc}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="proof-section" aria-labelledby="architecture-heading">
        <div className="section-kicker">ARCHITECTURE</div>
        <h2 id="architecture-heading">Arc-anchored checkout flow</h2>
        <div
          className="architecture-flow"
          role="img"
          aria-label="Merchant uses CheckoutFactory to create a deterministic invoice vault on Arc. Customer USDC routes through Circle CCTP to the Arc vault for merchant settlement."
        >
          <div>Merchant</div>
          <span>→</span>
          <div>CheckoutFactory</div>
          <span>→</span>
          <div>Deterministic invoice vault on Arc</div>
          <div>Customer source USDC</div>
          <span>→</span>
          <div>Circle CCTP</div>
          <span>→</span>
          <div>Arc vault → merchant settlement</div>
        </div>
      </section>

      <section className="proof-section" aria-labelledby="evidence-heading">
        <div className="section-kicker">REAL INTERACTION EVIDENCE</div>
        <h2 id="evidence-heading">Recorded Arc activity</h2>
        <p className="section-intro">
          Direct Arc funding, when recorded, verifies invoice settlement only
          and is not presented as crosschain CCTP evidence.
        </p>
        <div className="evidence-list">
          {interactionEvidence.map((item) => (
            <div key={item.key}>
              <span className="evidence-summary">
                <strong>{item.label}</strong>
                {item.evidence ? (
                  <small>
                    {item.evidence.observedEvent} · block {item.evidence.block}
                    {item.evidence.amount ? ` · ${item.evidence.amount}` : ""}
                  </small>
                ) : null}
              </span>
              {item.evidence ? (
                <a
                  href={item.evidence.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {compact(item.evidence.transactionHash)}{" "}
                  <ExternalLink size={13} />
                </a>
              ) : (
                <strong className="pending-label">Not yet recorded</strong>
              )}
            </div>
          ))}
        </div>
        <p className="section-intro">
          Recorded final state: Settled. Protocol fee: 0.002500 USDC. Customer
          excess refund: 0.050000 USDC. A second settlement call reverted with
          InvalidState(), confirming replay protection.
        </p>
        <Link href="/docs#evidence">How evidence is verified</Link>
      </section>

      <section
        className="proof-section"
        aria-labelledby="example-invoice-heading"
      >
        <div className="section-kicker">VERIFIED EXAMPLE INVOICE</div>
        <h2 id="example-invoice-heading">Real Arc settlement lifecycle</h2>
        <div className="proof-facts">
          <div>
            <span>Order ID</span>
            <strong>{verifiedExampleInvoice.orderId}</strong>
          </div>
          <div>
            <span>Merchant</span>
            <strong>{compact(verifiedExampleInvoice.merchant)}</strong>
          </div>
          <div>
            <span>Payer</span>
            <strong>{compact(verifiedExampleInvoice.payer)}</strong>
          </div>
          <div>
            <span>Invoice vault</span>
            <a
              href={verifiedExampleInvoice.vaultUrl}
              target="_blank"
              rel="noreferrer"
            >
              {compact(verifiedExampleInvoice.vault)} <ExternalLink size={13} />
            </a>
            <CopyButton
              label="Invoice vault address"
              value={verifiedExampleInvoice.vault}
            />
          </div>
          <div>
            <span>Expected amount</span>
            <strong>{verifiedExampleInvoice.expectedAmount}</strong>
          </div>
          <div>
            <span>Funded amount</span>
            <strong>{verifiedExampleInvoice.fundedAmount}</strong>
          </div>
          <div>
            <span>Merchant payout</span>
            <strong>{verifiedExampleInvoice.merchantAmount}</strong>
          </div>
          <div>
            <span>Protocol fee</span>
            <strong>{verifiedExampleInvoice.protocolFee}</strong>
          </div>
          <div>
            <span>Excess refund</span>
            <strong>{verifiedExampleInvoice.refundExcess}</strong>
          </div>
          <div>
            <span>Final state</span>
            <strong className="proof-ok">
              {verifiedExampleInvoice.finalState}
            </strong>
          </div>
          {[
            ["Creation transaction", verifiedExampleInvoice.creationUrl],
            ["Funding transaction", verifiedExampleInvoice.fundingUrl],
            ["Settlement transaction", verifiedExampleInvoice.settlementUrl],
          ].map(([label, url]) => (
            <div key={label}>
              <span>{label}</span>
              <a href={url} target="_blank" rel="noreferrer">
                Open ArcScan <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      </section>

      <section
        className="proof-section"
        aria-labelledby="implementation-heading"
      >
        <div className="section-kicker">IMPLEMENTATION EVIDENCE</div>
        <h2 id="implementation-heading">Open source and tested</h2>
        <div className="proof-facts">
          <div>
            <span>Repository</span>
            <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">
              Public GitHub <ExternalLink size={13} />
            </a>
          </div>
          <div>
            <span>CI</span>
            <a href={GITHUB_ACTIONS} target="_blank" rel="noreferrer">
              View latest workflow status <ExternalLink size={13} />
            </a>
          </div>
          <div>
            <span>Contract tests</span>
            <strong>
              {proofTestInventory.contractTests} Foundry test cases
            </strong>
          </div>
          <div>
            <span>Frontend tests</span>
            <strong>
              {proofTestInventory.frontendTests} unit/E2E test cases
            </strong>
          </div>
          <div>
            <span>Security status</span>
            <strong>
              <ShieldCheck size={15} /> Automated checks and internal review
            </strong>
          </div>
          <div>
            <span>External audit</span>
            <strong className="pending-label">Not externally audited</strong>
          </div>
        </div>
        <small>{proofTestInventory.basis}</small>
      </section>

      <section
        className="proof-section status-columns"
        aria-labelledby="status-heading"
      >
        <div className="section-kicker">CURRENT PROJECT STATUS</div>
        <h2 id="status-heading">Transparent testnet status</h2>
        <div>
          <article>
            <h3>Verified now</h3>
            <ul>
              <li>Public repository</li>
              <li>Four Arc contracts and source verification</li>
              <li>Onchain contract configuration</li>
              <li>Wallet chooser implementation</li>
              <li>Automated tests</li>
              <li>Deployment transactions</li>
              <li>Merchant registration and invoice creation</li>
              <li>EIP-712 payment attempt and Arc settlement</li>
            </ul>
          </article>
          <article>
            <h3>Implemented, validating</h3>
            <ul>
              <li>Complete CCTP route evidence</li>
              <li>Forwarding transaction correlation</li>
              <li>Public merchant backend and worker</li>
              <li>Signed webhook delivery</li>
            </ul>
          </article>
          <article>
            <h3>Roadmap</h3>
            <ul>
              <li>Mainnet readiness</li>
              <li>External smart-contract audit</li>
              <li>Production RPC redundancy</li>
              <li>Merchant integrations</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="proof-disclaimer">
        <strong>Ownership statement</strong>
        <p>
          SettleLink is an independent testnet product built on Arc. Arc is the
          settlement infrastructure. Circle CCTP is the crosschain transfer
          protocol. No endorsement is implied.
        </p>
        <p>
          Testnet software only; not externally audited. See{" "}
          <a
            href={`${GITHUB_REPOSITORY}/blob/main/SECURITY.md`}
            target="_blank"
            rel="noreferrer"
          >
            SECURITY.md
          </a>{" "}
          and{" "}
          <a
            href={`${GITHUB_REPOSITORY}/blob/main/docs/KNOWN_LIMITATIONS.md`}
            target="_blank"
            rel="noreferrer"
          >
            known limitations
          </a>
          .
        </p>
      </section>
    </div>
  );
}
