# SettleLink

Crosschain USDC checkout with settlement on Arc.

## Product

SettleLink is an independent, open-source Arc Testnet builder project. Merchants should not need to integrate several bridges, source chains, and reconciliation systems just to accept USDC.

A merchant creates an invoice, a deterministic settlement vault exists on Arc, the customer payment is associated with that vault, and merchant settlement happens on Arc. Circle CCTP V2 is the implemented crosschain routing layer.

## Current verified status

- The public frontend is available in read-only builder preview mode.
- Four project-owned contracts are deployed on Arc Testnet (chain ID `5042002`).
- Contract source is verified on ArcScan and the recorded configuration passes independent RPC verification.
- Deployment transactions and block `52918699` are recorded in [`deployments/arc-testnet.json`](deployments/arc-testnet.json).
- Wallet connection, contract interactions, CCTP routing, API, worker, indexer, PostgreSQL/Prisma, and signed webhook delivery are implemented in the repository.
- Automated Foundry, Vitest, and Playwright suites run in CI.
- The software is testnet-only and has not received an external smart-contract audit.

The public frontend intentionally disables backend-dependent merchant features until a production API and worker are enabled. It never falls back to a localhost API in production.

## Live links

- Public frontend: https://arc-crosschain-checkout.vercel.app
- Proof of Build: https://arc-crosschain-checkout.vercel.app/proof
- GitHub: https://github.com/hitmol/Arc-Crosschain-Checkout
- CI: https://github.com/hitmol/Arc-Crosschain-Checkout/actions
- Transaction evidence: [`docs/TRANSACTION_EVIDENCE.md`](docs/TRANSACTION_EVIDENCE.md)
- Documentation: [`docs/`](docs/)

## Project-owned contracts

| Contract                   | Arc Testnet address                                                                                                            | Deployment transaction                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| MerchantRegistry           | [`0x10d4611a4c434d990744bfd043bfacdb6d0edd08`](https://testnet.arcscan.app/address/0x10d4611a4c434d990744bfd043bfacdb6d0edd08) | [`0xcb7e3553…313d0e`](https://testnet.arcscan.app/tx/0xcb7e3553c62765c5ac55f98e1bb7e1c37083aee7440fa0398a3da7d266313d0e) |
| FeeManager                 | [`0x26b96dcb948288f1de15db321ffc0c034ecf7800`](https://testnet.arcscan.app/address/0x26b96dcb948288f1de15db321ffc0c034ecf7800) | [`0xfa59d04b…5d738f`](https://testnet.arcscan.app/tx/0xfa59d04b6f834ce042430d70f3114b205f8a62f03271d4ed2518f4e29e5d738f) |
| PaymentVaultImplementation | [`0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74`](https://testnet.arcscan.app/address/0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74) | [`0x100711cb…fac2b`](https://testnet.arcscan.app/tx/0x100711cb725e03fb589529f6a92a9c139f6ec64ffc735bce2af2a99e5bafac2b)  |
| CheckoutFactory            | [`0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e`](https://testnet.arcscan.app/address/0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e) | [`0x590a6017…181cc`](https://testnet.arcscan.app/tx/0x590a60175a6ea942b9b9bb460612d16f89a3138522771ac588fb290699a181cc)  |

USDC, Circle CCTP contracts, forwarding infrastructure, and wallets are shared infrastructure or operators—not project-owned contracts.

## Architecture

```text
Merchant -> CheckoutFactory -> deterministic invoice vault on Arc
Customer -> source USDC -> Circle CCTP -> Arc invoice vault -> settlement
```

The invoice vault is the onchain source of truth for expected amount, payout, refund authorization, fee snapshot, expiry, and final state. The database is an index and cache.

## Current project status

### Verified now

- public repository and read-only frontend;
- four deployed, source-verified Arc contracts;
- RPC-verified deployment configuration;
- wallet chooser implementation;
- automated Foundry, Vitest, and Playwright tests;
- contract deployment transactions.

### Implemented but still being validated

- complete public Base Sepolia → CCTP → Arc transaction evidence;
- forwarding transaction correlation;
- production API, worker, and indexer;
- signed webhook delivery in live infrastructure;
- manual WalletConnect QR verification on the final production origin.

### Roadmap

- external audit and mainnet readiness;
- production RPC redundancy and monitoring;
- merchant integrations.

## Local development

Requirements: Node.js 22+, pnpm 11+, Docker for PostgreSQL, and Foundry for contract work.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm demo:up
pnpm db:migrate
pnpm dev
```

Run the verification matrix:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm --filter @arc-checkout/contracts coverage
pnpm test:e2e
pnpm build
pnpm security:scan
pnpm audit --audit-level high
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Limitations and safety

SettleLink is testnet software, is not externally audited, and is not endorsed by Arc or Circle. Automatic crosschain refunds remain a recovery workflow rather than a universal atomic guarantee. Full public CCTP transaction evidence is still pending; current Arc-native funding evidence, once recorded, must not be interpreted as a crosschain checkout.

Read [`SECURITY.md`](SECURITY.md), [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md), and [`docs/BRAND_COMPLIANCE.md`](docs/BRAND_COMPLIANCE.md) before using or evaluating the code.
