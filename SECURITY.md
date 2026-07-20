# Security

## Trust assumptions

Circle-issued USDC and CCTP V2 contracts, Circle attestations, the Forwarding Service, Arc consensus, configured RPC providers, and OpenZeppelin libraries are external dependencies. The backend relayer is optional: settlement is permissionless and remains available through the UI if no relayer exists.

## Admin powers

The factory owner may pause only new invoice creation. The registry owner may deactivate a merchant for future invoices. The fee owner may update the fee (maximum 500 bps) and treasury only for future invoices. No administrator can change an existing vault's merchant payout, customer, customer refund address, fee, amount, or expiry, and no hidden USDC withdrawal exists.

## Customer payment authorization

Invoice creation does not set a refund recipient. Before any supported CCTP burn, the payer signs an EIP-712 `PaymentAuthorization` whose domain is `Arc Crosschain Checkout`, version `1`, Arc chain ID `5042002`, and the deterministic invoice vault. The signed message binds the attempt ID, source and destination chains, vault, order ID, payer, customer Arc refund address, destination amount, maximum source amount, quote expiry, nonce, and attempt expiry.

The first valid onchain authorization permanently locks the payer and refund address. An expired registered attempt may be replaced only by the same payer using the same refund address and a fresh nonce/attempt ID. Used nonces and attempt IDs cannot be replayed. Refunds remain on Arc and are never automatically bridged to the source chain.

Quotes are issued and stored by the API, expire quickly, and are claimed atomically once. The signed attempt must be persisted before Arc registration and any source burn. Browser progress updates require an attempt-scoped opaque secret whose hash alone is stored; that secret cannot authorize a payment or move funds.

## Fund safety

- Settlement uses checks-effects-interactions, SafeERC20, and reentrancy protection.
- A vault settles only when its Arc USDC balance reaches the expected amount and before expiry.
- Settlement and refunds require a customer-authorized attempt.
- Overpayment is returned to the locked customer Arc refund address.
- After expiry, anyone can execute the Arc-side refund.
- Pause never blocks an existing vault's settlement or refund.
- Unsupported tokens may be recovered by the merchant; vault USDC cannot use that path.
- A source burn is accepted only after receipt success, required confirmations, and direct payer-sender verification. The raw CCTP V2 message must match the authorized route, contracts, token, vault, payer, amount, maximum fee, finality, and forwarding hook. An Arc mint additionally requires a successful receipt and exact USDC transfer log; `forwardTxHash` alone is not settlement evidence.
- The optional settler can call only the same permissionless `settle()` entry point available to any user. Settlement claims are atomic, and the signed transaction hash is persisted before broadcast so worker crashes do not create a second settlement transaction. A signed settlement payload contains no reusable withdrawal authority.

## Backend and webhooks

All request input is runtime-validated. Public IDs are UUIDs. Merchant mutations require a short-lived wallet-signature session or a hashed, scoped API key. Customer attempts require a valid EIP-712 payer signature plus the matching unexpired server quote. App Kit recovery persists and resumes the same successful-burn result instead of creating another burn. Webhook secrets are AES-256-GCM encrypted, destinations are HTTPS/allowlisted and checked against private-address SSRF, signatures cover `timestamp.rawBody`, and retries are bounded.

## Known limitations

Refunds stay on Arc; they do not automatically bridge back to the customer's source chain. Testnet contracts are unaudited. Forwarding and protocol fees are dynamic. App Kit, wallet connectors, RPCs, and Circle APIs can be temporarily unavailable. A production release requires an independent audit, operational monitoring, incident response, key-management review, RPC redundancy, merchant authentication, compliance review, and mainnet-specific configuration validation.

## Reporting

Do not open public issues for suspected vulnerabilities. Contact the repository owner privately with impact, reproduction steps, and affected commit. No bug bounty is currently offered.
