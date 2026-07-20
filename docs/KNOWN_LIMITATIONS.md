# Known limitations

- Arc is testnet-only in this project.
- No project contracts or real CCTP transaction have been deployed/executed without user credentials.
- Contracts are not professionally audited.
- Refunds pay an Arc address and do not automatically return crosschain.
- Merchant mutations use nonce-protected wallet-signature sessions. Server API keys are hashed, scoped, revocable and shown only once, but account recovery and administrative audit UI remain pending.
- App Kit and Forwarding depend on Circle and RPC availability.
- The Arc indexer is finalized-block, cursor-based, paginated, idempotent, restart-tested, and exposes lag/error health. Production RPC failover and high-volume sharding remain pending.
- The web dashboard consumes authenticated, merchant-scoped indexed data with filtering, pagination, refresh, loading, empty, and error states. The public `/receipts/[invoiceSlug]` page consumes verified receipt records and supports printing, copy controls, explorer links, and JSON download. A signed PDF receipt is not implemented.
- The customer EIP-712 attempt, attempt-before-burn registration, server-issued quote, App Kit recovery state, and receipt-based CCTP reconciliation are implemented. A real testnet transfer still requires deployed project contracts, funded customer wallets, and operator-provided RPC/configuration evidence.
- Solana Devnet is intentionally deferred until the EVM flow is demonstrated reliably.
- The browser E2E suite uses a local mock CCTP lifecycle. It proves the application flow but is not a substitute for the required public testnet transaction evidence.
