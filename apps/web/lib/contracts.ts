import type { Abi } from "viem";
import checkoutFactoryAbiJson from "../abi/CheckoutFactory.json";
import merchantRegistryAbiJson from "../abi/MerchantRegistry.json";
import paymentVaultAbiJson from "../abi/PaymentVault.json";

// These ABIs come directly from the same Foundry artifacts as the deployed
// contracts. Keeping errors, events, and read methods intact is important for
// simulation, receipt decoding, and actionable wallet errors.
export const checkoutFactoryAbi = checkoutFactoryAbiJson as Abi;
export const merchantRegistryAbi = merchantRegistryAbiJson as Abi;
export const paymentVaultAbi = paymentVaultAbiJson as Abi;
