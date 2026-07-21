import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { brand } from "./brand";
import { resolveWalletPublicConfig } from "./wallet-connection";

export const walletPublicConfig = resolveWalletPublicConfig({
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  production: process.env.NODE_ENV === "production",
});
const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
if (
  typeof window !== "undefined" &&
  walletPublicConfig.walletConnectEnabled
)
  connectors.push(
    walletConnect({
      projectId: walletPublicConfig.projectId!,
      showQrModal: true,
      metadata: {
        name: brand.productName,
        description: brand.shortDescription,
        url: walletPublicConfig.canonicalAppUrl!,
        icons: [walletPublicConfig.productIconUrl!],
      },
    }),
  );

if (walletPublicConfig.issues.length > 0) {
  console.warn(
    `[${brand.productName} wallet configuration] ${walletPublicConfig.issues.join(" ")}`,
  );
}

export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors,
  multiInjectedProviderDiscovery: true,
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
    [baseSepolia.id]: http("https://sepolia.base.org"),
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com")
  },
  ssr: true
});
