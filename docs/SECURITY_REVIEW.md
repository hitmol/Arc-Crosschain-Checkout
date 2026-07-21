# Security and privacy review

## Scope

Internal review of the public Next.js frontend, environment validation, evidence tooling, Solidity contracts, repository content, and publication workflow. This is not an external audit.

## Controls verified

- Nonce-based production CSP with `strict-dynamic`; no production `unsafe-inline` script policy.
- Security headers include `nosniff`, `DENY` framing, strict referrer policy, and restricted browser permissions.
- Public deployment/evidence data is runtime-validated; zero placeholder hashes are rejected.
- Evidence recorder requires a successful RPC receipt, expected chain ID, matching recipient, and optional event topic.
- Production frontend has no localhost API fallback; missing API enables an explicit read-only state.
- WalletConnect is optional until configured and manually verified; malformed IDs are rejected.
- No private key is required in public browser variables. Deployment/interaction signing must use an encrypted keystore or hardware/browser wallet.
- Contract settlement is permissionless but payout and fee recipients come from immutable invoice snapshots.

## Residual risks

- Contracts have not been externally audited or formally verified.
- Timestamp expiry inherits normal block timestamp tolerance.
- Crosschain completion depends on Circle attestation/forwarding availability.
- A live API/worker deployment will need operational monitoring, key rotation, database backup, webhook replay controls, and RPC redundancy.
- Wallet extensions and relay services remain third-party trust boundaries.

## Publication checklist

- Run `pnpm security:scan` and `pnpm audit --audit-level high` before release.
- Review staged diffs and Git history for secrets.
- Inspect screenshots for tokens, cookies, emails, extension popups, and identity documents.
- Publish only intentionally public wallet and contract addresses.
- Keep the testnet and no-external-audit disclaimers visible.
