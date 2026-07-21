import { z } from "zod";
import deploymentRecord from "../../../deployments/arc-testnet.json";
import transactionEvidence from "../../../evidence/transaction-evidence.json";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hash = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .refine((value) => !/^0x0{64}$/i.test(value), "Placeholder hash rejected");

const deploymentSchema = z.object({
  network: z.literal("arc-testnet"),
  chainId: z.literal(5_042_002),
  status: z.literal("deployed"),
  deployer: address,
  treasury: address,
  usdc: address,
  protocolFeeBps: z.number().int().nonnegative().max(10_000),
  deploymentBlock: z.number().int().positive(),
  contracts: z.object({
    MerchantRegistry: address,
    FeeManager: address,
    PaymentVaultImplementation: address,
    CheckoutFactory: address,
  }),
  deploymentTransactions: z.object({
    MerchantRegistry: hash,
    FeeManager: hash,
    PaymentVaultImplementation: hash,
    CheckoutFactory: hash,
  }),
  deployedAt: z.string().datetime(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  tag: z.string().min(1),
  sourceVerification: z.object({
    status: z.literal("verified"),
    checkedAt: z.string().datetime(),
  }),
  onchainVerification: z.literal("passed"),
});

const evidenceSchema = z.object({
  action: z.string().min(1),
  environment: z.string().min(1),
  network: z.string().min(1),
  chainId: z.number().int().positive(),
  contract: z.string().min(1),
  method: z.string().min(1),
  sender: address,
  recipient: address,
  transactionHash: hash,
  block: z.number().int().positive(),
  timestamp: z.string().datetime(),
  expectedEvent: z.string().min(1),
  observedEvent: z.string().min(1),
  explorerUrl: z.string().url(),
  resultingState: z.string().min(1),
  relatedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  invoiceVault: address.optional(),
  amount: z.string().min(1).optional(),
  payout: address.optional(),
  protocolFee: z.string().min(1).optional(),
  refundExcess: z.string().min(1).optional(),
  orderId: hash.optional(),
  payer: address.optional(),
  merchantAmount: z.string().min(1).optional(),
  finalState: z.string().min(1).optional(),
});

export const parseDeploymentRecord = (value: unknown) =>
  deploymentSchema.parse(value);
export const parseTransactionEvidence = (value: unknown) =>
  z.array(evidenceSchema).parse(value);

export const arcDeployment = parseDeploymentRecord(deploymentRecord);
export const verifiedEvidence = parseTransactionEvidence(transactionEvidence);

export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const GITHUB_REPOSITORY =
  "https://github.com/hitmol/Arc-Crosschain-Checkout";
export const GITHUB_ACTIONS = `${GITHUB_REPOSITORY}/actions`;
export const PUBLIC_RELEASE_TAG = "v0.1.0-builder-preview";

export const projectContracts = [
  {
    name: "MerchantRegistry" as const,
    responsibility: "Registers merchants and their Arc payout addresses.",
  },
  {
    name: "FeeManager" as const,
    responsibility: "Stores the protocol fee and treasury configuration.",
  },
  {
    name: "PaymentVaultImplementation" as const,
    responsibility: "Implementation logic used by deterministic invoice vaults.",
  },
  {
    name: "CheckoutFactory" as const,
    responsibility: "Creates deterministic Arc invoice vaults with CREATE2.",
  },
].map((contract) => ({
  ...contract,
  address: arcDeployment.contracts[contract.name],
  deploymentTransaction: arcDeployment.deploymentTransactions[contract.name],
  addressUrl: `${ARC_EXPLORER}/address/${arcDeployment.contracts[contract.name]}`,
  transactionUrl: `${ARC_EXPLORER}/tx/${arcDeployment.deploymentTransactions[contract.name]}`,
  verificationStatus: arcDeployment.sourceVerification.status,
}));

const interactionDefinitions = [
  {
    key: "merchant",
    label: "Merchant registration",
    match: "merchant registration",
  },
  { key: "invoice", label: "Invoice creation", match: "invoice creation" },
  {
    key: "attempt",
    label: "EIP-712 payment attempt",
    match: "payment attempt registration",
  },
  { key: "funding", label: "Direct Arc Testnet vault funding", match: "vault funding" },
  { key: "settlement", label: "Arc settlement", match: "arc settlement" },
  { key: "cctp", label: "Full CCTP route", match: "cctp burn" },
] as const;

export const interactionEvidence = interactionDefinitions.map((definition) => ({
  ...definition,
  evidence: verifiedEvidence.find((entry) =>
    entry.action.toLowerCase().includes(definition.match),
  ),
}));

const exampleCreation = verifiedEvidence.find((entry) =>
  entry.action.toLowerCase().includes("invoice creation"),
);
const exampleAttempt = verifiedEvidence.find((entry) =>
  entry.action.toLowerCase().includes("payment attempt registration"),
);
const exampleFunding = verifiedEvidence.find((entry) =>
  entry.action.toLowerCase().includes("vault funding"),
);
const exampleSettlement = verifiedEvidence.find((entry) =>
  entry.action.toLowerCase().includes("arc settlement"),
);
if (
  !exampleCreation?.orderId ||
  !exampleCreation.invoiceVault ||
  !exampleCreation.amount ||
  !exampleAttempt?.payer ||
  !exampleFunding?.amount ||
  !exampleSettlement?.merchantAmount ||
  !exampleSettlement.protocolFee ||
  !exampleSettlement.refundExcess ||
  !exampleSettlement.finalState
)
  throw new Error("Verified example invoice evidence is incomplete");

export const verifiedExampleInvoice = {
  orderId: exampleCreation.orderId,
  merchant: exampleCreation.sender,
  payer: exampleAttempt.payer,
  vault: exampleCreation.invoiceVault,
  expectedAmount: exampleCreation.amount,
  fundedAmount: exampleFunding.amount,
  merchantAmount: exampleSettlement.merchantAmount,
  protocolFee: exampleSettlement.protocolFee,
  refundExcess: exampleSettlement.refundExcess,
  finalState: exampleSettlement.finalState,
  vaultUrl: `${ARC_EXPLORER}/address/${exampleCreation.invoiceVault}`,
  creationUrl: exampleCreation.explorerUrl,
  fundingUrl: exampleFunding.explorerUrl,
  settlementUrl: exampleSettlement.explorerUrl,
} as const;

export const proofTestInventory = {
  contractTests: 24,
  frontendTests: 23,
  basis:
    "24 Foundry test functions, 17 Vitest cases, and 6 Playwright cases in this release.",
} as const;
