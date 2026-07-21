# Builder proof video script

Status: pending recording at the owner’s request. Target length: 60–90 seconds.

## Shot list and narration

1. **Homepage (0–8s)** — “This is SettleLink, an independent crosschain USDC checkout built on Arc. Each merchant invoice receives a deterministic settlement vault on Arc, while Circle CCTP provides the crosschain routing layer.”
2. **Proof of Build (8–22s)** — Show network, deployment block, deployer, treasury, verified status, and the four project-owned contracts. “The public proof page uses the RPC-verified deployment record and requires no login or wallet.”
3. **GitHub and CI (22–32s)** — Open the repository and latest green workflow. “The Solidity, Next.js, API, worker, CCTP integration, tests, and evidence recorder are public.”
4. **ArcScan deployment/contract (32–42s)** — Open CheckoutFactory and its verified source.
5. **Merchant registration (42–51s)** — Open the real registration transaction and event.
6. **Invoice creation (51–61s)** — Open the creation transaction, `PaymentIntentCreated` event, and generated vault.
7. **Direct Arc funding and settlement (61–76s)** — Open the real Arc Testnet USDC funding and settlement transactions. State clearly: “This direct Arc funding verifies vault settlement; it is not a completed crosschain CCTP payment.”
8. **Wallet chooser (76–86s)** — Open the production wallet chooser and show a verified connection/disconnection.
9. **Close (86–90s)** — “SettleLink is testnet software, not externally audited, and no Arc or Circle endorsement is implied.”

Do not include fake amounts, users, hashes, dashboards, or pending CCTP evidence. Blur browser extensions or account details that are not intentionally public.
