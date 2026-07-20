# Architecture

## System

```mermaid
flowchart TB
  subgraph Source["Source testnets"]
    B["Base Sepolia USDC"]
    E["Ethereum Sepolia USDC"]
  end
  UI["Next.js checkout"] --> API["Node API"]
  UI --> B
  UI --> E
  B --> C["Circle CCTP V2 + Forwarding"]
  E --> C
  C --> V["Per-invoice PaymentVault on Arc"]
  V --> M["Merchant Arc payout"]
  V --> T["Protocol treasury"]
  V --> R["Arc refund address"]
  API --> DB["PostgreSQL index"]
  W["Settlement worker"] --> C
  W --> V
  W --> DB
  W --> H["Signed merchant webhook"]
```

The factory event and vault state are authoritative. PostgreSQL accelerates queries and records attempts, delivery state, and index cursors but cannot override Arc.

## Invoice creation

```mermaid
sequenceDiagram
  participant M as Merchant
  participant F as CheckoutFactory
  participant R as MerchantRegistry
  participant V as PaymentVault clone
  participant A as API/index
  M->>F: createPaymentIntent(orderId, amount, expiry, refund)
  F->>R: merchantOf(merchant)
  F->>V: CREATE2 clone + initialize locked settings
  F-->>M: PaymentIntentCreated(vault)
  M->>A: index confirmed transaction and vault
```

## Contract relationships

```mermaid
classDiagram
  MerchantRegistry <.. CheckoutFactory : reads merchant snapshot
  FeeManager <.. CheckoutFactory : reads current fee
  CheckoutFactory --> PaymentVault : deterministic clone
  PaymentVault --> USDC : balance and transfers
```

## Operational boundaries

- The browser signs merchant Arc transactions and customer source-chain CCTP transactions.
- The worker may sign only permissionless `settle()` calls; it never holds customer funds.
- Forwarding removes destination-mint signer and gas requirements.
- Webhook delivery begins only after onchain-derived state changes.
