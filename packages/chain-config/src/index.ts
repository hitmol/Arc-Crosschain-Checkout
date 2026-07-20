import { z } from "zod";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";

const evmChainSchema = z.object({
  key: z.enum(["arcTestnet", "baseSepolia", "ethereumSepolia"]),
  name: z.string(),
  chainId: z.number().int().positive(),
  cctpDomain: z.number().int().nonnegative(),
  appKitName: z.string(),
  rpcEnv: z.string(),
  defaultRpcUrl: z.string().url(),
  explorerUrl: z.string().url(),
  usdc: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenMessengerV2: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  messageTransmitterV2: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  decimals: z.literal(6),
  forwardingDestination: z.boolean(),
  confirmations: z.number().int().positive(),
});

export const CIRCLE_IRIS_SANDBOX = "https://iris-api-sandbox.circle.com";
export const FORWARDING_HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;
export const CCTP_FAST_FINALITY_THRESHOLD = 1000;
export const CCTP_STANDARD_FINALITY_THRESHOLD = 2000;

const sharedCctp = {
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  decimals: 6 as const,
  forwardingDestination: true,
};

export const chainConfig = z.array(evmChainSchema).parse([
  {
    ...sharedCctp,
    key: "arcTestnet",
    name: "Arc Testnet",
    chainId: 5_042_002,
    cctpDomain: 26,
    appKitName: "Arc_Testnet",
    rpcEnv: "ARC_RPC_URL",
    defaultRpcUrl: "https://rpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000",
    confirmations: 1,
  },
  {
    ...sharedCctp,
    key: "baseSepolia",
    name: "Base Sepolia",
    chainId: 84_532,
    cctpDomain: 6,
    appKitName: "Base_Sepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    confirmations: 2,
  },
  {
    ...sharedCctp,
    key: "ethereumSepolia",
    name: "Ethereum Sepolia",
    chainId: 11_155_111,
    cctpDomain: 0,
    appKitName: "Ethereum_Sepolia",
    rpcEnv: "ETHEREUM_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    confirmations: 2,
  },
]);

export const chainsById = new Map(
  chainConfig.map((chain) => [chain.chainId, chain]),
);
export const chainsByKey = Object.fromEntries(
  chainConfig.map((chain) => [chain.key, chain]),
) as Record<(typeof chainConfig)[number]["key"], (typeof chainConfig)[number]>;
export const viemChains = {
  arcTestnet,
  baseSepolia,
  ethereumSepolia: sepolia,
} as const;

export function explorerTx(chainId: number, hash: string): string {
  const chain = chainsById.get(chainId);
  if (!chain || !/^0x[a-fA-F0-9]{64}$/.test(hash))
    throw new Error("Invalid chain or transaction hash");
  return `${chain.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(chainId: number, address: string): string {
  const chain = chainsById.get(chainId);
  if (!chain || !/^0x[a-fA-F0-9]{40}$/.test(address))
    throw new Error("Invalid chain or address");
  return `${chain.explorerUrl}/address/${address}`;
}
