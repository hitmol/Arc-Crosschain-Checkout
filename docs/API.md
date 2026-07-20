# Dashboard and receipt APIs

`GET /api/dashboard` requires a merchant wallet session or an API key with `merchant:read`. The required `merchantAddress` query value must match the authenticated merchant. Optional query values are `status`, `sourceChainId`, `search`, `page`, and `pageSize` (maximum 50).

The response contains the indexed merchant profile, zero-filled status counts, total settled USDC volume, source-chain distribution, paginated invoices, recent attempts, customer/refund addresses, source/CCTP/Arc transaction evidence, latest webhook delivery state, and explorer URLs. Metrics are queried from merchant-scoped PostgreSQL records; production responses never substitute demo values.

`GET /api/receipts/:invoiceSlug` returns a JSON receipt assembled from the indexed invoice, verified source attempt, stored Circle quote/message, and finalized Arc event records. It includes the source total, Circle and forwarding fees, project treasury fee, merchant payout, refund/excess values, timestamps, transaction links, and ordered Arc evidence. Fields that have not been verified yet are `null` rather than fabricated.

Both endpoints return `Cache-Control: no-store`. The receipt endpoint is public because the invoice slug is already the checkout capability URL; merchants should avoid placing confidential data in order IDs or descriptions.
