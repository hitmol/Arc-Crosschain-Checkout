# Deployment

## Contracts

1. Obtain Arc Testnet USDC from the Circle faucet.
2. Import the deployer into Foundry's encrypted keystore: `cast wallet import arc-checkout-deployer`.
3. Set `ARC_RPC_URL`, `FOUNDRY_ACCOUNT`, `PROTOCOL_TREASURY`, and optionally `PROTOCOL_FEE_BPS`.
4. Run `pnpm deploy:contracts` and confirm the broadcast in the wallet/keystore prompt.
5. Verify every receipt on ArcScan and populate `deployments/arc-testnet.json` with real values only.

Do not provide a private key in a command-line flag. The current repository is `pending-credentials` and has not been deployed.

## Application

Deploy `apps/web`, `apps/api`, `apps/worker`, and PostgreSQL as separate services. Run Prisma migrations before API/worker rollout. Set a base64-encoded 32-byte `WEBHOOK_ENCRYPTION_KEY` through the platform secret manager, configure `AUTH_DOMAIN` to the canonical frontend host, and allow credentials only from `NEXT_PUBLIC_APP_URL`. Configure the Arc registry/factory addresses and deployment block for the worker indexer. Expose `GET /health` on `WORKER_PORT` (default `4001`) and alert on database/RPC failure, a recorded indexer error, or increasing finalized-block lag. The worker settler key is optional and must be a dedicated low-value key stored only in the platform secret manager.

## Checklist

- Contract receipts and source verification recorded.
- CSP/security headers tested at the edge.
- TLS, rate limits, request limits, backups, and monitoring enabled.
- API, worker, and database health checks green.
- Real Base Sepolia → Arc payment and webhook captured.
- Rollback plan tested; contract deployments are immutable.
