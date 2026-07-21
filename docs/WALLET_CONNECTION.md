# Wallet connection architecture

## What was wrong

The previous header action called `connectors[0]` directly. Connector order is configuration detail, not a wallet choice: an unavailable injected connector could be selected, multiple EIP-6963 providers were not presented, and users could not deliberately choose WalletConnect. Errors were not surfaced in the interface.

## Current design

`WalletButton` only opens an accessible native dialog. `WalletConnectDialog` obtains the current list from `useConnectors`, checks injected connectors with `connector.getProvider()`, removes unavailable and duplicate entries, and calls `useConnect().mutateAsync({ connector })` only after the user chooses one.

The dialog provides:

- EIP-6963 multi-provider discovery through `multiInjectedProviderDiscovery: true`;
- a generic EIP-1193 fallback for browsers that expose only `window.ethereum`;
- provider-specific names and safe HTTPS/data icons where advertised;
- a conditional WalletConnect QR/mobile option;
- explicit pending, rejected, missing-provider, relay, timeout, unsupported-chain, retry, and disconnect states;
- keyboard focus trapping, Escape/backdrop close, focus restoration, and status announcements;
- connected account, connector, and current-network details.

The UI does not request an immediate network change merely to connect. Network switching remains attached to the merchant/payment operation that needs a configured chain. The configured chains are Arc Testnet (`5042002`), Base Sepolia, and Ethereum Sepolia. Arc Testnet uses USDC as its native gas currency.

## WalletConnect gating

WalletConnect is created only when both conditions are valid:

1. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is exactly 32 hexadecimal characters.
2. `NEXT_PUBLIC_APP_URL` is an absolute canonical URL and uses HTTPS outside local development.

No fallback or sample project ID is used at runtime. Invalid configuration leaves browser wallets usable and displays a non-secret diagnostic instead of attempting a broken relay session. Metadata uses the SettleLink product name, description, canonical URL, and `/icon.svg` from that URL.

Current relevant package versions are `wagmi 3.7.3`, `viem 2.55.4`, `@walletconnect/ethereum-provider 2.21.1`, React `19.2.7`, and Next.js `16.2.10`.

## SSR and persistence

The shared wagmi configuration has `ssr: true`, while wallet controls are client components. The WalletConnect connector is constructed only when `window` exists because its provider setup requires browser storage such as IndexedDB. The dialog mounts after the first client render, keeping the initial server/client tree stable. Server-rendered application content does not depend on an account address, so it does not emit a conflicting server wallet state. Wagmi's client storage and injected connector disconnect shim preserve reconnect/disconnect intent across reloads. Playwright covers reload after connection and reload after disconnect with a deterministic EIP-1193 provider.

## Verification boundaries

Automated tests prove connector selection, filtering, configuration gating, error recovery, focus behavior, reload, and disconnect against mocked providers. They do not prove that a real WalletConnect project is accepted by the relay, that a real QR code pairs, or that a particular mobile wallet completes a session. Those checks require the operator setup in [WALLETCONNECT_SETUP.md](WALLETCONNECT_SETUP.md) and must be recorded separately in [WALLET_CONNECTION_EVIDENCE.md](WALLET_CONNECTION_EVIDENCE.md).

Primary implementation guidance:

- [wagmi connect-wallet guide](https://wagmi.sh/react/guides/connect-wallet)
- [wagmi injected connector](https://wagmi.sh/react/api/connectors/injected)
- [wagmi WalletConnect connector](https://wagmi.sh/react/api/connectors/walletConnect)
- [wagmi SSR guide](https://wagmi.sh/react/guides/ssr)
