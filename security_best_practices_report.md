# Security best-practices review

Review date: 2026-07-20
Scope: Solidity contracts, API, worker, web application, database schema, dependency graph, deployment configuration, and secret handling.

## Executive summary

No critical or high-severity findings were identified in this implementation review. The merchant-controlled refund finding is resolved by customer-signed EIP-712 payment attempts. The contracts compile and pass unit, fuzz and stateful invariant tests. Static secret/dangerous-pattern scanning passed. The production dependency audit reports no critical, high, or moderate advisories; one low-severity transitive advisory remains because the patched `elliptic` version named by the advisory is not published to npm.

This is still unaudited testnet software. A production launch remains blocked on independent contract review, complete attempt-before-burn UI/CCTP validation, deployment verification and real transaction evidence.

## Open findings

### SEC-01 — Shared backend secret is not merchant-scoped (Resolved)

- Resolution: The shared browser secret was removed. Merchant browser mutations now require a short-lived nonce-bound wallet signature and HTTP-only session. Server keys are hashed, permission-scoped, merchant-bound, revocable, rotatable, and displayed only once.
- Verification: invalid signer, expiry, replay, cross-merchant isolation, and key hashing tests are included in `apps/api/src/auth.test.ts`.

### SEC-02 — Unpatched low-severity transitive `elliptic` advisory (Low)

- Dependency path: Circle App Kit → ethers v5 → `elliptic@6.6.1`.
- Advisory: GHSA-848j-6mx2-7j84.
- Status: npm reports `>=6.6.2` as patched, but `6.6.2` is not currently published. Forced override was rejected by the registry and was not retained.
- Recommendation: monitor Circle App Kit/ethers dependency updates and upgrade when a published fix exists. Do not implement custom elliptic-curve signing in this application.

### SEC-03 — Timestamp-based invoice windows tolerate validator skew (Low)

- Locations: `packages/contracts/src/CheckoutFactory.sol:68`, `packages/contracts/src/PaymentVault.sol:143`, `packages/contracts/src/PaymentVault.sol:147`, `packages/contracts/src/PaymentVault.sol:176`.
- Impact: Validators can influence timestamps slightly around an invoice boundary.
- Mitigation: the minimum invoice lifetime is five minutes; timestamp skew cannot redirect funds, change locked recipients, or bypass the funded/terminal-state checks.
- Recommendation: document a short operational grace period and avoid invoices with tight time-sensitive business consequences.

## Controls verified

- Existing vaults remain usable when factory creation is paused (`CheckoutFactory.sol:120`).
- Fee configuration is capped at 500 bps and snapshotted into each invoice (`FeeManager.sol:10`).
- Settlement uses checks-effects-interactions, reentrancy protection, and `SafeERC20`; terminal state is written before transfers (`PaymentVault.sol:146-160`).
- Customer EIP-712 authorization locks payer/refund ownership; nonce and attempt ID replay are rejected; the unsupported-token recovery path rejects USDC (`PaymentVault.sol`).
- Webhook secrets use AES-256-GCM at rest, HMAC-SHA256 signatures, timestamped payloads, HTTPS restrictions, DNS/private-IP SSRF checks, and bounded retries (`apps/api/src/security.ts:19-116`).
- API mutation payloads are validated, bodies are limited to 64 KiB, rate limits are enabled, and payment-intent creation requires idempotency keys (`apps/api/src/app.ts:70-105`, `apps/api/src/app.ts:171-236`).
- Demo mode now defaults off, cannot run under `NODE_ENV=production`, and non-demo API/worker processes fail closed without required secrets (`apps/api/src/config.ts:27-36`, `apps/worker/src/worker.ts:52-56`).
- CSP, frame blocking, restrictive source lists, and production removal of `unsafe-eval` are set in `apps/web/proxy.ts`.
- Patched transitive versions of `uuid` and `postcss` are locked in `pnpm-workspace.yaml:5`; the application was rebuilt after the overrides.

## Verification evidence

- `pnpm security:scan` — passed.
- `pnpm audit --prod` — 0 critical, 0 high, 0 moderate, 1 low.
- `pnpm lint` — passed after review fixes.
- `pnpm typecheck` — passed across all workspaces.
- `pnpm build` — passed across all workspaces.
- Foundry — 29 tests passed after the refund-model change: 24 unit/fuzz tests and 5 invariants, each with 256 runs and 128,000 calls.
- Foundry coverage — 80.67% lines overall and 95.28% lines for `PaymentVault.sol` with the CI `--ir-minimum` profile.
- Contract size — `PaymentVault` runtime bytecode is 9,053 bytes, leaving 15,523 bytes below the EVM limit.
- Browser — desktop and 390 px mobile render checks passed; primary navigation passed; 0 console errors and 0 warnings after fixes.

## Production gates

1. Independent smart-contract audit and remediation.
2. Complete the attempt-before-burn App Kit registration and recovery flow.
3. Hardware/KMS-backed relayer key with low balance and monitoring, or remove the optional relayer.
4. Multisig ownership, tested two-step transfers, incident runbook, and RPC redundancy.
5. Live testnet deployment evidence, explorer verification, end-to-end CCTP transaction, and refund recovery drill.
6. Dependency update that removes the remaining `elliptic` advisory.
