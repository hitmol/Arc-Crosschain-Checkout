# Known limitations

- Arc is testnet-only in this project.
- No project contracts or real CCTP transaction have been deployed/executed without user credentials.
- Contracts are not professionally audited.
- Refunds pay an Arc address and do not automatically return crosschain.
- Merchant mutation authentication uses an internal API secret outside demo mode; wallet-signature sessions are planned.
- App Kit and Forwarding depend on Circle and RPC availability.
- The worker implementation favors clarity over high-volume sharding.
- The dashboard seed is explicitly labeled demo data until the indexer is connected.
- Solana Devnet is intentionally deferred until the EVM flow is demonstrated reliably.
- Receipt PDF export is represented by browser printing; a signed PDF artifact is not implemented.
