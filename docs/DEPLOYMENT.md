# Deployment

The web application has preview deployments, but production is not approved. `deployments/arc-testnet.json` remains `pending-credentials`; a Vercel preview and null deployment fields are not contract or mainnet evidence.

## 1. Final Arc contracts

Deployment is intentionally gated on a clean, tagged release candidate, green CI, passing Foundry tests, an encrypted Foundry keystore account, and adequate Arc Testnet USDC gas balance.

Prepare locally without sharing secrets:

```text
cast wallet import arc-checkout-deployer
git tag v0.1.0-hackathon-rc1
git push origin v0.1.0-hackathon-rc1
```

Set `ARC_RPC_URL`, `FOUNDRY_ACCOUNT`, `PROTOCOL_TREASURY`, and optionally `PROTOCOL_FEE_BPS`, `ARC_USDC_ADDRESS`, and `MIN_DEPLOYER_GAS_WEI` in the local shell or secret manager. Never pass a plaintext private key. Then run:

```text
pnpm deploy:preflight
pnpm deploy:contracts
pnpm verify:deployment -- --write
```

The cross-platform wrapper:

- verifies Arc chain ID `5042002`;
- requires the official Arc Testnet USDC `0x3600000000000000000000000000000000000000`, deployed bytecode, and `decimals() == 6`;
- resolves the deployer only from `FOUNDRY_ACCOUNT` and rejects plaintext-key inputs;
- validates treasury, fee bounds, and minimum native Arc USDC gas balance;
- runs all Foundry tests before broadcasting;
- parses Foundry receipts for all four deployments;
- verifies bytecode, successful receipts, owners, treasury, protocol fee, and every CheckoutFactory constructor relationship;
- atomically replaces `deployments/arc-testnet.json` only after all checks pass.

ArcScan source verification is a separate best-effort operation. An ArcScan outage must not invalidate a successfully receipt-verified deployment, and the source-verification status must be recorded independently.

## 2. Application topology

Deploy four separate components:

1. PostgreSQL 16+ with TLS, restricted network access, migrations, and backups.
2. `apps/api` as a long-running Node service.
3. `apps/worker` as a continuously running process, never as an ephemeral request-only function.
4. `apps/web` on Vercel or an equivalent Next.js platform.

Run `pnpm --filter @arc-checkout/database migrate:deploy` against the production database before rolling out API or worker.

`Dockerfile.api` and `Dockerfile.worker` build the two Node services from the monorepo and define health checks. `vercel.json` builds the Next.js workspace from the repository root so its shared workspace packages remain available. Validate each secret set before rollout:

```text
pnpm validate:env web
pnpm validate:env api
pnpm validate:env worker
```

### Frontend environment

```text
NODE_ENV=production
DEMO_MODE=false
NEXT_PUBLIC_APP_URL=https://<frontend-host>
NEXT_PUBLIC_API_URL=https://<api-host>
NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS=<verified deployment>
NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS=<verified deployment>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<public project id>
```

The Vercel build runs `scripts/validate-web-deployment-env.mjs`. Production fails closed when required public variables are missing or malformed. Preview remains buildable for design review, but WalletConnect is omitted and live contract actions must remain unavailable. See [WalletConnect setup](WALLETCONNECT_SETUP.md) and [wallet evidence](WALLET_CONNECTION_EVIDENCE.md).

### API environment

```text
NODE_ENV=production
DEMO_MODE=false
DATABASE_URL=<TLS PostgreSQL URL>
NEXT_PUBLIC_APP_URL=https://<frontend-host>
AUTH_DOMAIN=<frontend-host-without-scheme>
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHECKOUT_FACTORY_ADDRESS=<verified deployment>
ARC_MERCHANT_REGISTRY_ADDRESS=<verified deployment>
WEBHOOK_ENCRYPTION_KEY=<base64 32-byte secret>
ALLOWED_WEBHOOK_HOSTS=<comma-separated merchant hosts>
```

### Worker environment

```text
NODE_ENV=production
DEMO_MODE=false
DATABASE_URL=<same TLS PostgreSQL URL>
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHECKOUT_FACTORY_ADDRESS=<verified deployment>
ARC_MERCHANT_REGISTRY_ADDRESS=<verified deployment>
ARC_DEPLOYMENT_BLOCK=<verified deployment block>
ARC_INDEXER_PAGE_SIZE=1000
CIRCLE_API_BASE_URL=https://iris-api-sandbox.circle.com
WEBHOOK_ENCRYPTION_KEY=<same secret as API>
SETTLER_PRIVATE_KEY=<optional dedicated low-value key>
```

If automated settlement is enabled, create a dedicated low-value settler wallet, fund it with minimal Arc Testnet USDC, never reuse the deployer, merchant, treasury, or customer key, and store it only in the platform secret manager.

## 3. Health and rollout checks

- `GET /api/health` verifies API process and database connectivity.
- Worker `GET /health` (default port `4001`) reports database, Arc RPC, Circle API reachability, worker tick state, cursor, finalized head, lag, and indexer errors.
- Treat database/RPC/Circle failure, worker tick errors, or growing finalized-block lag as rollout failures.
- Verify CORS credentials, CSP/security headers, TLS, rate limits, request limits, backups, and alerting.

## 4. Evidence and rollback

Record each successful receipt with `pnpm record:evidence -- ...`; see the command help and `docs/TRANSACTION_EVIDENCE.md`. Do not type hashes or URLs into submission material until the recorder or equivalent direct verification confirms them.

Application services can roll back to a prior immutable image. Contract deployments cannot roll back; pause only new invoice creation if necessary, preserve settlement/refund paths, and deploy a new version rather than mutating recorded evidence.
