# Arc Builder Form package

Ready-to-copy factual answers. Replace only bracketed operator details.

## Project name

SettleLink

## One-line description

SettleLink is a crosschain USDC checkout built on Arc, using deterministic invoice vaults for merchant settlement and Circle CCTP for crosschain payment routing.

## Protocol type

Payments / Crosschain checkout / Merchant settlement infrastructure

## Problem

Merchants should not need to integrate several bridges, source chains, and reconciliation systems to accept USDC. Crosschain payment status and refund handling are difficult to reconcile against a single order.

## Solution

A merchant creates a payment intent and deterministic invoice vault on Arc. The customer payment is associated with that vault, and permissionless settlement pays the merchant and protocol treasury according to the vault snapshot. Circle CCTP V2 is the implemented routing layer for native USDC from supported source testnets. The public proof page exposes the verified contracts and transaction evidence without authentication.

## Why Arc

Invoice vaults live on Arc. Final settlement, merchant payout, and protocol fee distribution execute on Arc, while Arc Testnet USDC is also the native gas asset. Arc is the settlement system—not only a network selector in the UI.

## Circle tools

- USDC: implemented on supported testnets.
- CCTP V2: implemented and tested in code; final public crosschain transaction evidence pending.
- Forwarding Service: implemented and tested in code; final public transaction correlation pending.
- Iris API: implemented and tested in code; final public transaction evidence pending.
- Circle App Kit: wallet/payment integration implemented in the frontend.

## Project-owned contracts

- MerchantRegistry: `0x10d4611a4c434d990744bfd043bfacdb6d0edd08`
- FeeManager: `0x26b96dcb948288f1de15db321ffc0c034ecf7800`
- PaymentVaultImplementation: `0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74`
- CheckoutFactory: `0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e`

USDC, CCTP contracts, the Forwarding Service, and wallets are not project-owned.

## Public links

- Website: https://arc-crosschain-checkout.vercel.app
- Proof of Build: https://arc-crosschain-checkout.vercel.app/proof
- Contracts: https://arc-crosschain-checkout.vercel.app/proof#contracts
- GitHub: https://github.com/hitmol/Arc-Crosschain-Checkout
- Transaction evidence: https://github.com/hitmol/Arc-Crosschain-Checkout/blob/main/docs/TRANSACTION_EVIDENCE.md
- Documentation: https://github.com/hitmol/Arc-Crosschain-Checkout/tree/main/docs

## Current status

Arc Testnet contracts are deployed and source verified. The deployment configuration and receipts pass independent Arc RPC verification. A real merchant registration, invoice creation, EIP-712 payment attempt, direct Arc vault funding, and final settlement are publicly recorded. The 1.000000 USDC invoice distributed 0.997500 USDC to the merchant, 0.002500 USDC to the treasury, and refunded 0.050000 USDC excess to the customer. The full public CCTP route is still being finalized and is not claimed as complete.

## Builder contribution

SettleLink demonstrates original Solidity contracts, deterministic Arc settlement vaults, public open-source code, automated tests, wallet integration, Circle CCTP integration, technical documentation, and verifiable testnet deployment evidence.

## Video

Pending recording. Script: [`BUILDER_VIDEO_SCRIPT.md`](BUILDER_VIDEO_SCRIPT.md).
