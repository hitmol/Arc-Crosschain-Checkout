# Deployment status

## Completed: Arc Testnet contracts

The deployment recorded in [`deployments/arc-testnet.json`](../deployments/arc-testnet.json) has been independently checked against `https://rpc.testnet.arc.network`.

- Network: Arc Testnet
- Chain ID: `5042002`
- Deployment block: `52918699`
- Deployer: `0x4879a69d08dc2ffe9d63000b74bdeb5f22f2ecf7`
- Treasury: `0x667a87b5bc9e461aa991055aa25e3d8674c42969`
- Protocol fee: 25 bps
- Arc USDC interface: `0x3600000000000000000000000000000000000000`
- Source verification: verified on ArcScan
- Onchain relationship verification: passed

| Project-owned contract     | Address                                      | Deployment transaction                                               |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| MerchantRegistry           | `0x10d4611a4c434d990744bfd043bfacdb6d0edd08` | `0xcb7e3553c62765c5ac55f98e1bb7e1c37083aee7440fa0398a3da7d266313d0e` |
| FeeManager                 | `0x26b96dcb948288f1de15db321ffc0c034ecf7800` | `0xfa59d04b6f834ce042430d70f3114b205f8a62f03271d4ed2518f4e29e5d738f` |
| PaymentVaultImplementation | `0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74` | `0x100711cb725e03fb589529f6a92a9c139f6ec64ffc735bce2af2a99e5bafac2b` |
| CheckoutFactory            | `0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e` | `0x590a60175a6ea942b9b9bb460612d16f89a3138522771ac588fb290699a181cc` |

Verify locally without mutating the record:

```bash
ARC_RPC_URL=https://rpc.testnet.arc.network pnpm verify:deployment
```

The verifier rejects a wrong chain, missing or reverted deployment receipts, absent bytecode, wrong owners, wrong treasury/fee, or mismatched factory relationships.

## Public frontend modes

When `NEXT_PUBLIC_API_URL` is absent, the Vercel frontend keeps public onchain builder capabilities enabled: wallet connection, Arc network switching, MerchantRegistry reads/writes, CheckoutFactory invoice creation, receipt decoding, deterministic invoice routes, and browser-local recovery. `/proof` reads the verified deployment and evidence records at build time.

Backend merchant sessions, database history, webhooks, and reconciliation are enabled separately only when a validated HTTPS production API URL exists. The absence of that URL must never disable onchain invoice creation.

Production never silently falls back to `http://localhost:4000`. A configured production API must use HTTPS and must not target localhost.

## Pending live infrastructure

- production API, worker, PostgreSQL connection, and Arc indexer;
- live signed webhook delivery;
- production monitoring and RPC redundancy;
- full Base Sepolia → Circle CCTP → Arc evidence;
- mainnet deployment and external audit.

The current public proof package does not depend on those pending items.
