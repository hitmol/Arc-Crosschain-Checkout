import { parseAbi } from "viem";

export const merchantRegistryAbi = parseAbi([
  "function registerMerchant(address payoutAddress, bytes32 metadataHash)",
  "function updatePayoutAddress(address newPayoutAddress)",
  "function merchantOf(address merchant) view returns ((address owner,address payoutAddress,bytes32 metadataHash,bool active,uint64 createdAt))"
]);

export const checkoutFactoryAbi = parseAbi([
  "function createPaymentIntent(bytes32 orderId,uint256 expectedAmount,uint64 expiresAt,address refundAddress,bytes32 metadataHash) returns (address vault)",
  "function predictPaymentVault(address merchant,bytes32 orderId) view returns (address)",
  "event PaymentIntentCreated(bytes32 indexed orderId,address indexed merchant,address indexed vault,address payoutAddress,address refundAddress,uint256 expectedAmount,uint16 protocolFeeBps,uint64 expiresAt,bytes32 metadataHash)"
]);

export const paymentVaultAbi = parseAbi([
  "function currentBalance() view returns (uint256)",
  "function amountRemaining() view returns (uint256)",
  "function paymentState() view returns (uint8)",
  "function settle()",
  "function refund()"
]);
