# Technical decisions

Verified 2026-07-20 using official Arc and Circle primary documentation.

## App Kit and direct primitives

Circle App Kit with the Viem browser-wallet adapter is selected for customer bridging because the product may later add send/swap capabilities. The API and worker use Circle Iris endpoints directly for fee quotes and resumable status indexing. App Kit abstracts approve, burn, attestation, and mint while the application retains invoice-specific state.

## Forwarding Service

Arc, Base, and Ethereum support CCTP V2 and Arc supports Forwarding as a destination. The vault is the EVM `mintRecipient`; `destinationCaller` remains unrestricted. This avoids a destination relayer wallet for minting and does not violate the documented wrapper limitation.

## Per-invoice vaults

A deterministic EIP-1167 clone is cheaper than a full contract and gives every CCTP transfer an onchain invoice identity. Payout, refund, fee, amount, and expiry are locked during initialization.

## PostgreSQL as index

Prisma/PostgreSQL provides durable attempts, cursors, webhook retries, and dashboard queries. Contradictory database data never authorizes settlement; the worker rereads the vault.

## No upgradeable protocol

The factory, registry, manager, and vault implementation are intentionally non-upgradeable. New versions require new deployments and explicit migration, reducing hackathon governance risk.

## Testnet configuration

- Arc Testnet: chain 5042002, domain 26, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`.
- Base Sepolia: chain 84532, domain 6, native USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Ethereum Sepolia: chain 11155111, domain 0, native USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
- Arc USDC: `0x3600000000000000000000000000000000000000`.

No project-owned deployment address is published until a receipt exists.
