# Known limitations

## Current testnet preview

- SettleLink is Arc Testnet software and has not been externally audited.
- The public frontend is a read-only builder preview while the production API and worker are disabled.
- Backend-dependent merchant onboarding, invoice creation, dashboard, checkout, and receipt pages disclose that limitation instead of using mock production data.
- WalletConnect QR requires a valid WalletConnect project ID and exact production-origin allowlisting; manual evidence must not be marked complete until tested.
- Browser wallet availability depends on the reviewer having an injected provider such as MetaMask or Rabby.

## Crosschain route

- Circle CCTP V2 and the Forwarding Service are implemented and tested in code, but full public Base Sepolia → Arc transaction evidence is pending.
- Direct Arc Testnet USDC vault funding proves vault settlement only; it is not evidence of a completed crosschain payment.
- Crosschain transfers are asynchronous and rely on Circle attestation/forwarding availability.
- Automatic crosschain refunds are not universally atomic. Recovery may require expiry, attestation, or manual operator coordination.

## Smart contracts

- Timestamp-based expiry uses Arc block time and inherits normal validator timestamp tolerance.
- Settlement is permissionless by design and can only use the payout and fee snapshot stored in the vault.
- A successful customer-authorized payment attempt must be registered before settlement/refund logic can proceed.
- Mainnet deployment, formal verification, and an external audit remain roadmap items.

## Operations

- Production monitoring, RPC failover, rate-limit tuning, key rotation, disaster recovery drills, and merchant support procedures are not yet live.
- No real merchant adoption, payment volume, or endorsement is claimed.
