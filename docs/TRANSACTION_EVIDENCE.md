# Transaction Evidence

No real transaction evidence has been recorded for the final release candidate yet. This is intentionally honest: contract deployment and the public testnet E2E flow remain blocked until a funded Foundry keystore account, separate treasury/merchant/customer wallets, and live infrastructure credentials are available.

Use `pnpm record:evidence -- ...` after each successful transaction. The recorder queries the configured RPC, rejects reverted or missing receipts, validates the chain, and regenerates this document from `evidence/transaction-evidence.json`.

## Required proof still missing

- Final Arc Testnet contract deployments.
- Merchant registration and invoice creation.
- Base Sepolia USDC approval and CCTP burn.
- Circle message and Arc forwarding mint.
- Arc settlement and signed webhook delivery.
- Customer-owned refund drill.
