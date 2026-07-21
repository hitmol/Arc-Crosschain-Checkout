# Transaction Evidence

This file is generated from the verified deployment record and successful receipts queried from the configured RPC. The recorder rejects reverted or missing receipts, wrong chains, mismatched recipients, malformed or zero hashes, and absent required event topics.

## Deployment evidence

- Network: Arc Testnet (5042002)
- Deployment block: 52918699
- Source verification: verified
- Onchain configuration verification: passed

| Project-owned contract     | Address                                                                                                                      | Deployment transaction                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MerchantRegistry           | [0x10d4611a4c434d990744bfd043bfacdb6d0edd08](https://testnet.arcscan.app/address/0x10d4611a4c434d990744bfd043bfacdb6d0edd08) | [0xcb7e3553…](https://testnet.arcscan.app/tx/0xcb7e3553c62765c5ac55f98e1bb7e1c37083aee7440fa0398a3da7d266313d0e) |
| FeeManager                 | [0x26b96dcb948288f1de15db321ffc0c034ecf7800](https://testnet.arcscan.app/address/0x26b96dcb948288f1de15db321ffc0c034ecf7800) | [0xfa59d04b…](https://testnet.arcscan.app/tx/0xfa59d04b6f834ce042430d70f3114b205f8a62f03271d4ed2518f4e29e5d738f) |
| PaymentVaultImplementation | [0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74](https://testnet.arcscan.app/address/0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74) | [0x100711cb…](https://testnet.arcscan.app/tx/0x100711cb725e03fb589529f6a92a9c139f6ec64ffc735bce2af2a99e5bafac2b) |
| CheckoutFactory            | [0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e](https://testnet.arcscan.app/address/0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e) | [0x590a6017…](https://testnet.arcscan.app/tx/0x590a60175a6ea942b9b9bb460612d16f89a3138522771ac588fb290699a181cc) |

## Arc interaction evidence

| Action                             | Network               | Method                 | Transaction                                                                                                      |    Block | Timestamp                | Observed event           | Resulting state                                                        | Commit         |
| ---------------------------------- | --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | -------: | ------------------------ | ------------------------ | ---------------------------------------------------------------------- | -------------- |
| Merchant registration              | Arc Testnet (5042002) | registerMerchant       | [0xb7baf54e…](https://testnet.arcscan.app/tx/0xb7baf54e15a1c32c19407ffb367d1ff5496891bccf9a937f85cd4c76402a5e19) | 52934356 | 2026-07-21T12:27:00.000Z | MerchantRegistered       | merchant active with payout 0x4879A69d08dc2fFE9D63000B74BdEB5F22F2eCF7 | `433ca1dbbdb7` |
| Invoice creation                   | Arc Testnet (5042002) | createPaymentIntent    | [0xf1ab7fab…](https://testnet.arcscan.app/tx/0xf1ab7fab7db0538d36ac29d94e1ed2566c8f386c7be5249e98edbc43735f3ddf) | 52934374 | 2026-07-21T12:27:14.000Z | PaymentIntentCreated     | invoice vault created at 0x6CC2aE6d5a2e4dDCCc96cF4fC35Ea4bd30F5aD8c    | `433ca1dbbdb7` |
| Payment attempt registration       | Arc Testnet (5042002) | registerPaymentAttempt | [0x0d0f5955…](https://testnet.arcscan.app/tx/0x0d0f595583c72dd8e130892ee4829ebf5eec53b0636f6a41572836f56b58d2c8) | 52936597 | 2026-07-21T12:55:12.000Z | PaymentAttemptRegistered | customer EIP-712 authorization locked                                  | `433ca1dbbdb7` |
| Vault funding (direct Arc Testnet) | Arc Testnet (5042002) | transfer               | [0xa15bd914…](https://testnet.arcscan.app/tx/0xa15bd914d9c6d0b3bf67ca07e3f579e164137091976a47e65da54df6a11360d1) | 52936610 | 2026-07-21T12:55:18.000Z | Transfer                 | vault funded directly on Arc Testnet; not CCTP evidence                | `433ca1dbbdb7` |
| Arc settlement                     | Arc Testnet (5042002) | settle                 | [0xeccbc528…](https://testnet.arcscan.app/tx/0xeccbc52892cd6048bff8483cc678518cf328fd7df88fba38bf2dc9eeb29ba8f6) | 52936616 | 2026-07-21T12:55:26.000Z | PaymentSettled           | vault settled; second settlement reverted with InvalidState()          | `433ca1dbbdb7` |

### Missing Arc interaction proof

- None.

Direct Arc Testnet funding, when present, verifies invoice settlement. It is not crosschain CCTP evidence.

## Crosschain evidence

Expected correlation fields are source approval, CCTP burn, Circle message hash/attestation, Arc forwarding mint, and Arc settlement.

- CCTP source approval: not yet recorded
- CCTP burn: not yet recorded
- Arc forwarding mint: not yet recorded

Circle message data and signed webhook delivery evidence must be added only after a real end-to-end run. They are not blockchain transactions and are not synthesized by this receipt recorder.
