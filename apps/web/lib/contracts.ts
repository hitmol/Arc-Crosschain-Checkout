import type { Abi } from "viem";
import checkoutFactoryArtifact from "../../../packages/contracts/out/CheckoutFactory.sol/CheckoutFactory.json";
import merchantRegistryArtifact from "../../../packages/contracts/out/MerchantRegistry.sol/MerchantRegistry.json";
import paymentVaultArtifact from "../../../packages/contracts/out/PaymentVault.sol/PaymentVault.json";

// These ABIs come directly from the same Foundry artifacts as the deployed
// contracts. Keeping errors, events, and read methods intact is important for
// simulation, receipt decoding, and actionable wallet errors.
export const checkoutFactoryAbi = checkoutFactoryArtifact.abi as Abi;
export const merchantRegistryAbi = merchantRegistryArtifact.abi as Abi;
export const paymentVaultAbi = paymentVaultArtifact.abi as Abi;
