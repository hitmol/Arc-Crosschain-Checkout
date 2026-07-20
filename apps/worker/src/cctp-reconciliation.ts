import {
  decodeEventLog,
  isAddressEqual,
  parseAbi,
  type Address,
  type Hash,
  type Log,
  type Transaction,
  type TransactionReceipt,
} from "viem";

const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

export class CctpReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpReconciliationError";
  }
}

export function validateSourceTransaction(input: {
  receipt: Pick<
    TransactionReceipt,
    "status" | "blockNumber" | "transactionHash"
  >;
  transaction: Pick<Transaction, "from" | "hash">;
  expectedHash: Hash;
  expectedPayer: Address;
  headBlock: bigint;
  requiredConfirmations: number;
}): boolean {
  if (
    input.receipt.transactionHash.toLowerCase() !==
      input.expectedHash.toLowerCase() ||
    input.transaction.hash.toLowerCase() !== input.expectedHash.toLowerCase()
  )
    throw new CctpReconciliationError("Source receipt hash mismatch");
  if (input.receipt.status !== "success")
    throw new CctpReconciliationError("Source burn transaction reverted");
  if (!isAddressEqual(input.transaction.from, input.expectedPayer))
    throw new CctpReconciliationError(
      "Source transaction sender is not the authorized payer",
    );
  const confirmations = input.headBlock - input.receipt.blockNumber + 1n;
  return confirmations >= BigInt(input.requiredConfirmations);
}

export function validatedArcMintAmount(input: {
  receipt: Pick<TransactionReceipt, "status" | "logs">;
  usdc: Address;
  vault: Address;
  expectedAmount: bigint;
}): bigint {
  if (input.receipt.status !== "success")
    throw new CctpReconciliationError("Arc forwarding transaction reverted");
  const matchingAmounts: bigint[] = [];
  for (const log of input.receipt.logs) {
    if (!isAddressEqual(log.address, input.usdc)) continue;
    try {
      const decoded = decodeEventLog({
        abi: transferAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName === "Transfer" &&
        isAddressEqual(decoded.args.to, input.vault)
      )
        matchingAmounts.push(decoded.args.value);
    } catch {
      // The USDC transaction may contain logs for other event signatures.
    }
  }
  if (
    matchingAmounts.length !== 1 ||
    matchingAmounts[0] !== input.expectedAmount
  )
    throw new CctpReconciliationError(
      "Arc receipt does not contain exactly one expected USDC transfer to the vault",
    );
  return matchingAmounts[0];
}

export type ReceiptLog = Log;
