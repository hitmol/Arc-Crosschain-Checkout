# Security

## Trust assumptions

Circle-issued USDC and CCTP V2 contracts, Circle attestations, the Forwarding Service, Arc consensus, configured RPC providers, and OpenZeppelin libraries are external dependencies. The backend relayer is optional: settlement is permissionless and remains available through the UI if no relayer exists.

## Admin powers

The factory owner may pause only new invoice creation. The registry owner may deactivate a merchant for future invoices. The fee owner may update the fee (maximum 500 bps) and treasury only for future invoices. No administrator can change an existing vault's merchant payout, refund address, fee, amount, or expiry, and no hidden USDC withdrawal exists.

## Fund safety

- Settlement uses checks-effects-interactions, SafeERC20, and reentrancy protection.
- A vault settles only when its Arc USDC balance reaches the expected amount and before expiry.
- Overpayment is returned to the locked Arc refund address.
- After expiry, anyone can execute the Arc-side refund.
- Pause never blocks an existing vault's settlement or refund.
- Unsupported tokens may be recovered by the merchant; vault USDC cannot use that path.

## Backend and webhooks

All request input is runtime-validated. Public IDs are UUIDs. Mutation APIs require an internal secret outside explicit demo mode; production merchant wallet-signature authentication remains a roadmap item. Webhook secrets are AES-256-GCM encrypted, destinations are HTTPS/allowlisted and checked against private-address SSRF, signatures cover `timestamp.rawBody`, and retries are bounded.

## Known limitations

Refunds stay on Arc; they do not automatically bridge back to the customer's source chain. Testnet contracts are unaudited. Forwarding and protocol fees are dynamic. App Kit, wallet connectors, RPCs, and Circle APIs can be temporarily unavailable. A production release requires an independent audit, operational monitoring, incident response, key-management review, RPC redundancy, merchant authentication, compliance review, and mainnet-specific configuration validation.

## Reporting

Do not open public issues for suspected vulnerabilities. Contact the repository owner privately with impact, reproduction steps, and affected commit. No bug bounty is currently offered.
