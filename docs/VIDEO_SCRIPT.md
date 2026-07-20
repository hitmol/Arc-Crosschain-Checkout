# Three-minute video script

## 0:00–0:20 — Problem

“This merchant wants USDC on Arc. Their customer already has USDC, but on Base. Today that means bridge UX, another gas system, and manual reconciliation.” Show the two wallets/networks.

## 0:20–0:40 — Solution

“Arc Crosschain Checkout turns one order into one payment link. Customers pay native USDC from a supported chain; the merchant always settles on Arc.” Open the landing page and route strip.

## 0:40–1:05 — Create invoice

Connect the merchant wallet on Arc Testnet. Enter `ORDER-1042`, `125.00 USDC`, one-hour expiry, and refund address. Submit. Show the factory transaction, emitted vault address, payment URL, and QR code.

## 1:05–1:50 — Customer payment

Open the payment link. Connect Base Sepolia. Explain merchant amount, live Circle protocol fee, forwarding fee, buffer, and total source spend. Approve and submit the real CCTP V2 transfer. Show the Base explorer burn hash.

## 1:50–2:15 — Crosschain progress

Follow approval, burn, Circle attestation, forwarded Arc mint, and vault funding. Refresh the page to demonstrate resumable tracking. Open the real `forwardTxHash` on ArcScan.

## 2:15–2:35 — Arc settlement

Let the worker call `settle()` or click **Finalize on Arc**. Show the vault's settlement event, merchant USDC payout, protocol fee, and prevention of repeated settlement.

## 2:35–2:50 — Merchant tools

Open dashboard, receipt, and webhook delivery. Show the HMAC signature verification example and delivery log.

## 2:50–3:00 — Closing

“Customers start wherever their USDC lives. Every invoice ends in a deterministic Arc vault, with USDC for payment and gas. Next: audit, mainnet configuration, and commerce plugins.” End on repository and submission page.
