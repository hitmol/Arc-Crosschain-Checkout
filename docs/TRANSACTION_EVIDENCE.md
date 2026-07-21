# Transaction Evidence

Deployment data has been independently verified through the Arc RPC. Interaction rows are added only by `scripts/record-transaction-evidence.mjs`, which rejects reverted or missing receipts, wrong chains, mismatched recipients, malformed or zero hashes, and absent required event topics.

## Deployment evidence

- Network: Arc Testnet (`5042002`)
- Deployment block: `52918699`
- Source verification: verified
- Onchain configuration verification: passed

| Project-owned contract     | Address                                                                                                                        | Deployment transaction                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| MerchantRegistry           | [`0x10d4611a4c434d990744bfd043bfacdb6d0edd08`](https://testnet.arcscan.app/address/0x10d4611a4c434d990744bfd043bfacdb6d0edd08) | [`0xcb7e3553…`](https://testnet.arcscan.app/tx/0xcb7e3553c62765c5ac55f98e1bb7e1c37083aee7440fa0398a3da7d266313d0e) |
| FeeManager                 | [`0x26b96dcb948288f1de15db321ffc0c034ecf7800`](https://testnet.arcscan.app/address/0x26b96dcb948288f1de15db321ffc0c034ecf7800) | [`0xfa59d04b…`](https://testnet.arcscan.app/tx/0xfa59d04b6f834ce042430d70f3114b205f8a62f03271d4ed2518f4e29e5d738f) |
| PaymentVaultImplementation | [`0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74`](https://testnet.arcscan.app/address/0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74) | [`0x100711cb…`](https://testnet.arcscan.app/tx/0x100711cb725e03fb589529f6a92a9c139f6ec64ffc735bce2af2a99e5bafac2b) |
| CheckoutFactory            | [`0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e`](https://testnet.arcscan.app/address/0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e) | [`0x590a6017…`](https://testnet.arcscan.app/tx/0x590a60175a6ea942b9b9bb460612d16f89a3138522771ac588fb290699a181cc) |

## Arc interaction evidence

| Action                                    | Network | Method | Transaction | Block | Timestamp | Observed event | Resulting state | Commit |
| ----------------------------------------- | ------- | ------ | ----------- | ----: | --------- | -------------- | --------------- | ------ |
| No real interaction evidence recorded yet | —       | —      | —           |     — | —         | —              | —               | —      |

Missing: merchant registration, invoice creation, payment-attempt registration, direct Arc vault funding, and Arc settlement.

Direct Arc Testnet funding, when recorded, verifies invoice settlement. It is not crosschain CCTP evidence.

## Crosschain evidence

Pending: source approval, CCTP burn, Circle message hash/attestation, Arc forwarding mint, and transaction correlation. The CCTP integration is implemented and tested in code; no completed crosschain checkout is claimed here.
