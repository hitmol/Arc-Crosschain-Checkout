# Contributing

Use Node 20.9+ and pnpm 11. Run `pnpm install`, create a branch, keep changes focused, and run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before opening a pull request. Contract changes also require `pnpm test:contracts` and updated security documentation. Never commit private keys, API keys, database credentials, seed phrases, or a populated `.env` file.
