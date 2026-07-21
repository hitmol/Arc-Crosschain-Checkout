# WalletConnect setup

WalletConnect is deliberately disabled until a real Reown/WalletConnect project is configured. The project ID is public application configuration, but it must still be a valid ID belonging to this application.

## 1. Create and restrict the project

1. Create/select a SettleLink project in the Reown dashboard.
2. Copy its 32-character hexadecimal Project ID.
3. Configure an origin allowlist with exact origins used for testing and production. Start with:
   - `http://localhost:3000`
   - the exact selected Vercel preview origin used for the acceptance test
   - the final canonical production origin
4. Remove obsolete preview origins after testing. Do not leave the allowlist empty and do not use a broad wildcard for production.

Allowlist changes may take time to propagate. A relay rejection immediately after an edit is not evidence that the application code is wrong.

## 2. Configure Vercel

Set the value independently for Preview and Production; do not copy a placeholder:

```text
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<real 32-hex project id>
NEXT_PUBLIC_APP_URL=https://<the exact origin for that environment>
```

Also configure the remaining frontend variables documented in [DEPLOYMENT.md](DEPLOYMENT.md). `NEXT_PUBLIC_*` values are embedded into the browser bundle at build time, so redeploy after every change. Production builds fail preflight if required web variables are absent or malformed. Preview builds remain available for UI review but show WalletConnect/live-action diagnostics.

## 3. Acceptance test

After redeployment, record each result without exposing the Project ID:

1. Open the deployed page in a clean desktop browser profile.
2. Open **Connect wallet** and confirm each installed EIP-6963 wallet appears once.
3. Select WalletConnect, confirm the QR modal opens, and inspect the console/network panel for relay, CSP, `401`, or `403` errors.
4. Pair a real supported mobile wallet, approve the session, and confirm the same address appears in SettleLink.
5. Reload and confirm reconnection.
6. Open wallet details, disconnect, reload, and confirm it stays disconnected.
7. Reconnect, perform the operation that requires Arc Testnet, and verify the wallet receives an explicit switch/add-chain request only at that point.
8. Repeat on the final production origin before promotion is considered complete.

If the QR modal fails, check the exact origin allowlist, project status, build-time environment scope, metadata URL/icon HTTPS reachability, CSP console errors, ad/privacy blockers, and relay reachability. Do not declare the flow fixed until a real pairing is documented.

Official setup reference: [WalletConnect App SDK installation and allowlist](https://docs.walletconnect.network/app-sdk/javascript/installation).
