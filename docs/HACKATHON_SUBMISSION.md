# Arc Programmable Money Hackathon submission

## Project name

SettleLink

## One-line description

Accept USDC from multiple chains through one payment link and settle every invoice on Arc.

## Problem

Merchants cannot easily accept USDC from customers across multiple chains without integrating several wallets, bridges, destination gas systems, and reconciliation services.

## Solution

A merchant creates one Arc-settled invoice. The customer pays USDC from a supported chain. CCTP routes native USDC to a unique invoice vault on Arc, where the payment is automatically settled and reconciled.

## Why Arc

Arc is the actual settlement layer: every invoice vault, payout, refund rule, fee distribution, and final event lives there. USDC pays for both application value and gas, so merchants do not need a volatile destination gas token. Deterministic finality closes checkout state quickly, and every source route converges into consistent Arc liquidity.

## Circle tools actually integrated

- USDC
- CCTP V2
- Circle Forwarding Service
- Circle Iris fee and message APIs
- Circle App Kit with the Viem adapter

## Original contracts

- MerchantRegistry
- FeeManager
- CheckoutFactory
- PaymentVault

USDC, TokenMessengerV2, MessageTransmitterV2, TokenMinterV2, and Forwarding Service are shared Circle infrastructure, not project contracts.

## Technical achievements

- Deterministic per-invoice EIP-1167 vaults
- Live crosschain fee quoting and gross-up
- Resumable browser and backend payment state
- Customer-owned EIP-712 refund authorization before any burn
- Raw CCTP V2 message and Arc receipt validation
- Restart-safe finalized Arc indexing and atomic settlement claims
- Authenticated live-data dashboard and verified downloadable receipts
- Permissionless settlement and timeout refunds
- Transactional, ordered, encrypted-secret HMAC-signed webhook outbox
- Typed TypeScript merchant SDK
- Mocked Playwright checkout-to-receipt E2E coverage

## Deployment evidence

Pending credentials. No address, hash, live URL, or transaction is claimed until verified.

## Production roadmap

Independent security audit, mainnet configuration, more source chains, compliance integrations, automatic crosschain refunds, accounting integrations, checkout plugins, multi-currency invoices, RPC redundancy, and production reliability monitoring.
