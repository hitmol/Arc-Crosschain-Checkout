import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { brand } from "./brand";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const connectors = [injected({ shimDisconnect: true })];
if (projectId)
  connectors.push(
    walletConnect({
      projectId,
      metadata: {
        name: brand.productName,
        description: brand.shortDescription,
        url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        icons: [],
      },
    }),
  );

export const wagmiConfig = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors,
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
    [baseSepolia.id]: http("https://sepolia.base.org"),
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com")
  },
  ssr: true
});
