# Local development

1. Install Node 20.9+, pnpm 11, Docker, Git, and Foundry.
2. Copy `.env.example` to `.env`. The checked-in file contains no secrets.
3. Run:

```bash
pnpm install
pnpm demo:up
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev
```

Web runs on port 3000, API on 4000, worker health/logs in the worker process, and PostgreSQL on 5432. Demo mode is visibly labeled and uses deterministic local records; it does not claim testnet hashes.

For contracts:

```bash
pnpm test:contracts
pnpm --filter @arc-checkout/contracts coverage
```

For a real testnet flow, set the three RPC values, deploy project contracts, copy their real addresses into public configuration, set `DEMO_MODE=false`, and restart all processes.
