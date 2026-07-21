# Brand migration: Arc Crosschain Checkout to SettleLink

## Scope

The public product identity changed to **SettleLink**. Arc remains the destination network and settlement infrastructure. This migration intentionally separates product ownership from infrastructure attribution without changing the checkout, recovery, reconciliation, or receipt model.

## Changed

- Public header, footer, homepage, dashboard, invoice creation, checkout, receipt, docs, README, favicon, metadata, manifest, and social preview.
- WalletConnect application metadata and Circle App Kit payment identity.
- API sign-in copy, API log name, SDK fallback errors, and Solidity comments.
- EIP-712 `PaymentAuthorization` domain name from `Arc Crosschain Checkout` to `SettleLink`.
- Downloaded receipt filename prefix from `arc-receipt-` to `settlelink-receipt-`.
- Configurable public product name through `NEXT_PUBLIC_PRODUCT_NAME`, validated by the shared brand configuration.

## Deliberately retained for compatibility

- Monorepo package scope and published import shape: `@arc-checkout/*` and `ArcCheckout`.
- Existing API headers such as `x-arc-timestamp`.
- Existing environment variables and deployment names that identify Arc contracts or the Arc settlement network.
- Existing local-storage keys and persisted payment recovery records.
- Repository URL and historical Git commits.

These are technical compatibility identifiers, not public operator claims. Renaming them requires a separately versioned API/SDK migration.

## Breaking deployment note

The EIP-712 domain change modifies payment-authorization digests. Any contract compiled with the old domain is incompatible with signatures created by the new web/API build. Because the project has no final production deployment, the source now uses `SettleLink`. Before any live transaction:

1. deploy a fresh `PaymentVault` implementation and factory configuration;
2. update verified deployment addresses in every service;
3. invalidate old unsigned/quoted attempts;
4. run the cross-language authorization tests and a real testnet payment;
5. never mix an old contract deployment with the new signer UI/API.

## Rollout checklist

- [ ] Confirm brand name availability and trademark review outside this engineering scope.
- [ ] Set Vercel environment value `NEXT_PUBLIC_PRODUCT_NAME=SettleLink`.
- [ ] Deploy and verify contracts built with the SettleLink EIP-712 domain.
- [ ] Update live WalletConnect metadata and preview caches.
- [ ] Record new screenshots and testnet evidence.
- [ ] Perform Arc/Circle brand review if co-marketing or official logo use is planned.
