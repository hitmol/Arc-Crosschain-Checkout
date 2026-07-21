# Wallet connection evidence

Updated: 2026-07-21

This record distinguishes deterministic automated coverage from real external-wallet evidence.

| Check                                                  | Current result                | Evidence / limitation                                                                               |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Connector configuration and error unit tests           | Passed                        | `apps/web/lib/wallet-connection.test.ts`                                                            |
| Production environment validation tests                | Passed                        | `scripts/validate-environment.test.mjs`                                                             |
| Accessible chooser with no injected provider           | Passed                        | Playwright Chromium; `evidence/wallet/wallet-dialog-no-provider.png`                                |
| Mocked injected approval and rejected-request recovery | Passed                        | Playwright Chromium; deterministic EIP-1193 test and `evidence/wallet/wallet-dialog-injected.png`   |
| Reload after connect; disconnect and reload            | Passed                        | Playwright Chromium with deterministic EIP-1193 provider                                            |
| SSR with WalletConnect dependency present              | Passed                        | Browser-only connector construction; final E2E run had no server `indexedDB` exception              |
| EIP-6963 deduplication                                 | Passed                        | Unit test; not yet exercised with two real extensions                                               |
| Production dependency audit                            | High issues resolved          | `ws` is forced to patched `8.21.1`; one upstream Circle/ethers `elliptic` low advisory remains      |
| Vercel contract configuration                          | Configured                    | Production/preview/development factory and registry variables use the verified Arc deployment       |
| Public read-only proof mode                            | Passed in code                | Missing API disables backend routes; production preflight rejects a localhost API                   |
| Stable production URL                                  | Pending final deployment      | Target: `https://arc-crosschain-checkout.vercel.app`                                                |
| Anonymous deployed-browser check                       | Pending production retest     | Existing preview opened anonymously; stable production must be retested after deployment            |
| Real WalletConnect QR modal                            | Not tested                    | Requires a valid project ID and allowlisted deployed origin                                         |
| Real mobile pairing                                    | Not tested                    | Requires a real QR session and mobile wallet approval                                               |
| Real desktop extension                                 | Not tested                    | Automated tests use a mocked provider; Chrome profile was not used to approve a real wallet session |
| Arc Testnet switch/add-chain prompt                    | Not tested with a real wallet | Connection itself intentionally does not switch networks                                            |

Passing mock tests must not be reported as proof of WalletConnect relay, QR, mobile deep-link, extension interoperability, or real signing. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` and the exact production-origin allowlist remain operator actions. Add dated browser/device, wallet name/version, deployed URL, and observed result here after following [WALLETCONNECT_SETUP.md](WALLETCONNECT_SETUP.md). Never record seed phrases, private keys, session topics, or the full project ID.
