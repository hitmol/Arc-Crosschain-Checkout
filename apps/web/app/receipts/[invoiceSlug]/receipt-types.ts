export type AddressView = { address: string; url: string } | null;
export type TransactionView = { hash: string; url: string } | null;

export type VerifiedReceipt = {
  receiptVersion: number;
  verifiedFrom: string[];
  merchant: {
    name: string | null;
    walletAddress: string;
    payoutAddress: string;
    payoutExplorer: AddressView;
  };
  invoice: {
    id: string;
    slug: string;
    orderId: string;
    vault: AddressView;
    amount: string;
    amountAtomic: string;
    fundedAmount: string;
    status: string;
    description: string | null;
  };
  customer: {
    walletAddress: string;
    arcRefundAddress: string | null;
  } | null;
  source: {
    network: {
      chainId: number;
      name: string;
      explorerUrl: string | null;
    };
    totalAmount: string;
    totalAmountAtomic: string;
    circleProtocolFee: string | null;
    forwardingFee: string | null;
    gasNote: string;
    burnTransaction: TransactionView;
  } | null;
  cctp: {
    status: string;
    messageHash: string | null;
    eventNonce: string | null;
    sourceDomain: number | null;
    destinationDomain: number | null;
    finalityThreshold: number | null;
    attestationReceived: boolean;
  } | null;
  arc: {
    network: {
      chainId: number;
      name: string;
      explorerUrl: string | null;
    };
    mintTransaction: TransactionView;
    settlementTransaction: TransactionView;
    merchantPayout: string | null;
    treasuryFee: string | null;
    excessAmount: string | null;
    refundedAmount: string | null;
  };
  timestamps: {
    invoiceCreatedAt: string;
    attemptCreatedAt: string | null;
    attemptUpdatedAt: string | null;
    settledAt: string | null;
    lastUpdatedAt: string;
  };
  evidence: Array<{
    type: string;
    chainId: number;
    transaction: TransactionView;
    logIndex: number;
    blockNumber: string;
    blockHash: string;
  }>;
};
