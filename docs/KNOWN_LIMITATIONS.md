# Known limitations

- Arc is testnet-only in this project.
- No project contracts or real CCTP transaction have been deployed/executed without user credentials.
- Contracts are not professionally audited.
- Refunds pay an Arc address and do not automatically return crosschain.
- Merchant mutations use nonce-protected wallet-signature sessions. Server API keys are hashed, scoped, revocable and shown only once, but account recovery and administrative audit UI remain pending.
- App Kit and Forwarding depend on Circle and RPC availability.
- The Arc indexer is cursor-based, paginated and idempotent, but production RPC redundancy and high-volume sharding remain pending.
- The dashboard still contains explicitly labeled demo data and must be replaced with authenticated indexed metrics.
- The invoice refund address is still selected during merchant invoice creation. Customer-signed payment-attempt refund ownership is not implemented yet, so the payment flow is not production-ready.
- Solana Devnet is intentionally deferred until the EVM flow is demonstrated reliably.
- Receipt PDF export is represented by browser printing; a signed PDF artifact is not implemented.
