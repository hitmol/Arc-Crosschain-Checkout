# Three-minute demo runbook

## Start

Run PostgreSQL, migrations, seed, and `pnpm dev` as described in local development. For the hackathon recording use `DEMO_MODE=false`, verified contract addresses, funded wallets, and the real Circle sandbox.

## Live flow

1. Open merchant onboarding, connect the merchant wallet, switch to Arc Testnet, and register.
2. Create an invoice with a unique order ID, USDC amount, and one-hour expiry. Invoice creation does not choose the customer refund recipient.
3. Copy the public URL and show the deterministic vault on ArcScan.
4. Open the link in a customer session and connect a Base Sepolia wallet.
5. Obtain test USDC from the Circle faucet and Base Sepolia ETH from an official faucet before filming.
6. Request the live Circle quote; narrate merchant amount, protocol fee, forwarding fee, and total source spend.
7. As the customer, choose and confirm the Arc refund address, sign the EIP-712 payment authorization, register it on Arc, then approve and pay. Show the source burn transaction, attestation state, `forwardTxHash`, and verified Arc mint.
8. Let the worker settle or click **Finalize on Arc** if the worker key is absent.
9. Show the Arc settlement receipt, merchant balance, dashboard row, and signed webhook delivery.

## Recovery

- Rejected wallet request: retry; no source state changed.
- Replaced source transaction: capture the replacement hash in the attempt.
- Attestation delay: leave status pending and use **Resume transfer** with the persisted successful-burn `BridgeResult`.
- Forwarding delay: query `/v2/messages/{sourceDomain}`; never reburn after a successful source burn.
- Worker unavailable: use the permissionless finalize button.
- Arc RPC unavailable: switch the non-secret RPC URL and restart the worker.
- Testnet instability during recording: show the previously confirmed real receipt and clearly state the service delay; do not substitute local demo hashes.
