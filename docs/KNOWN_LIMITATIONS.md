# Known limitations

- Arc is testnet-only in this project.
- No project contracts or real CCTP transaction have been deployed/executed without user credentials.
- Contracts are not professionally audited.
- Refunds pay an Arc address and do not automatically return crosschain.
- Merchant mutations use nonce-protected wallet-signature sessions. Server API keys are hashed, scoped, revocable and shown only once, but account recovery and administrative audit UI remain pending.
- App Kit and Forwarding depend on Circle and RPC availability.
- The Arc indexer is cursor-based, paginated and idempotent, but production RPC redundancy and high-volume sharding remain pending.
- The dashboard still contains explicitly labeled demo data and must be replaced with authenticated indexed metrics.
- The customer EIP-712 attempt, attempt-before-burn registration, server-issued quote, App Kit recovery state, and receipt-based CCTP reconciliation are implemented. A real testnet transfer still requires deployed project contracts, funded customer wallets, and operator-provided RPC/configuration evidence.
- Solana Devnet is intentionally deferred until the EVM flow is demonstrated reliably.
- Receipt PDF export is represented by browser printing; a signed PDF artifact is not implemented.
