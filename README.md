# SettleLink

Crosschain USDC checkout with settlement on Arc.

## Product

SettleLink is an independent, open-source Arc Testnet builder project. Merchants should not need to integrate several bridges, source chains, and reconciliation systems just to accept USDC.

A merchant creates an invoice, a deterministic settlement vault exists on Arc, the customer payment is associated with that vault, and merchant settlement happens on Arc. Circle CCTP V2 is the implemented crosschain routing layer.

## Current verified status

- The public production deployment supports real Arc Testnet merchant registration, invoice creation, public invoice import from verified Arc factory transactions, and same-origin backend API health checks.
- Four project-owned contracts are deployed on Arc Testnet (chain ID `5042002`).
- Contract source is verified on ArcScan and the recorded configuration passes independent RPC verification.
- Deployment transactions and block `52918699` are recorded in [`deployments/arc-testnet.json`](deployments/arc-testnet.json).
- A real merchant registration, invoice creation, EIP-712 payment attempt, direct Arc Testnet USDC funding, and settlement are recorded with successful receipts in [`evidence/transaction-evidence.json`](evidence/transaction-evidence.json).
- Wallet connection, contract interactions, CCTP routing, API, targeted worker reconciliation, indexer, PostgreSQL/Prisma, and signed webhook delivery are implemented in the repository.
- Automated Foundry, Vitest, and Playwright suites run in CI.
- The software is testnet-only and has not received an external smart-contract audit.

The public frontend keeps onchain merchant registration, invoice creation, receipt verification, browser-local invoice history, and verified Arc transaction import available on the production origin. It never falls back to a localhost API in production.

## Live links

- Public frontend: https://arc-crosschain-checkout.vercel.app
- Proof of Build: https://arc-crosschain-checkout.vercel.app/proof
- GitHub: https://github.com/hitmol/Arc-Crosschain-Checkout
- CI: https://github.com/hitmol/Arc-Crosschain-Checkout/actions
- Transaction evidence: [`docs/TRANSACTION_EVIDENCE.md`](docs/TRANSACTION_EVIDENCE.md)
- Documentation: [`docs/`](docs/)

## Project-Deployed Contracts

| Contract                   | Arc Testnet address                                                                                                            | Deployment transaction                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| MerchantRegistry           | [`0x10d4611a4c434d990744bfd043bfacdb6d0edd08`](https://testnet.arcscan.app/address/0x10d4611a4c434d990744bfd043bfacdb6d0edd08) | [`0xcb7e3553…313d0e`](https://testnet.arcscan.app/tx/0xcb7e3553c62765c5ac55f98e1bb7e1c37083aee7440fa0398a3da7d266313d0e) |
| FeeManager                 | [`0x26b96dcb948288f1de15db321ffc0c034ecf7800`](https://testnet.arcscan.app/address/0x26b96dcb948288f1de15db321ffc0c034ecf7800) | [`0xfa59d04b…5d738f`](https://testnet.arcscan.app/tx/0xfa59d04b6f834ce042430d70f3114b205f8a62f03271d4ed2518f4e29e5d738f) |
| PaymentVaultImplementation | [`0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74`](https://testnet.arcscan.app/address/0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74) | [`0x100711cb…fac2b`](https://testnet.arcscan.app/tx/0x100711cb725e03fb589529f6a92a9c139f6ec64ffc735bce2af2a99e5bafac2b)  |
| CheckoutFactory            | [`0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e`](https://testnet.arcscan.app/address/0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e) | [`0x590a6017…181cc`](https://testnet.arcscan.app/tx/0x590a60175a6ea942b9b9bb460612d16f89a3138522771ac588fb290699a181cc)  |

USDC, Circle CCTP contracts, forwarding infrastructure, and wallets are shared infrastructure or operators—not project-owned contracts.

## External Arc and Circle Dependencies

USDC, Circle CCTP contracts, forwarding infrastructure, Arc RPC endpoints, ArcScan, Circle Faucet, browser wallets, Base Sepolia, and Ethereum Sepolia are shared infrastructure or third-party services, not project-owned contracts.

## Architecture

```text
Merchant -> CheckoutFactory -> deterministic invoice vault on Arc
Customer -> source USDC -> Circle CCTP -> Arc invoice vault -> settlement
```

The invoice vault is the onchain source of truth for expected amount, payout, refund authorization, fee snapshot, expiry, and final state. The database is an index and cache.

## Current project status

### Verified now

- public repository and onchain builder frontend;
- four deployed, source-verified Arc contracts;
- RPC-verified deployment configuration;
- wallet chooser implementation;
- automated Foundry, Vitest, and Playwright tests;
- contract deployment transactions.
- real Arc-native checkout activity through final settlement, including protocol fee and excess refund distribution.

### Implemented but still being validated

- complete public Base Sepolia → CCTP → Arc transaction evidence;
- forwarding transaction correlation;
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
pnpm --filter @arc-checkout/web test:e2e:onchain
pnpm security:scan
pnpm audit --audit-level high
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Limitations and safety

SettleLink is testnet software, is not externally audited, and is not endorsed by Arc or Circle. Browser-local invoice history is limited to invoices created in that browser and is not a complete merchant database. Automatic crosschain refunds remain a recovery workflow rather than a universal atomic guarantee. Full public CCTP transaction evidence is still pending; direct Arc funding proves vault settlement but must not be interpreted as a completed CCTP checkout.

Read [`SECURITY.md`](SECURITY.md), [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md), and [`docs/BRAND_COMPLIANCE.md`](docs/BRAND_COMPLIANCE.md) before using or evaluating the code.

## Official documentation used

- Arc docs index: https://docs.arc.io/llms.txt
- Connect to Arc: https://docs.arc.io/integrate/connect-to-arc
- Arc RPC endpoints: https://docs.arc.io/arc/references/rpc-endpoints
- Arc contract addresses: https://docs.arc.io/arc/references/contract-addresses
- Arc stablecoin native model: https://docs.arc.io/arc/concepts/stablecoin-native-model
- App Kit and Bridge: https://docs.arc.io/app-kit and https://docs.arc.io/app-kit/bridge
- Arc Brand Guidelines and Partner Toolkit: https://www.arc.io/brand-guidelines-and-partner-toolkit
