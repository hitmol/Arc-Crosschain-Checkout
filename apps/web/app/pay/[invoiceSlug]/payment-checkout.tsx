"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppKit, type BridgeResult } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import {
  bytesToHex,
  hashTypedData,
  isAddress,
  type EIP1193Provider,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { arcTestnet, baseSepolia, sepolia } from "viem/chains";
import { orderIdToBytes32, parseUsdc } from "@arc-checkout/shared";
import { chainsById } from "@arc-checkout/chain-config";
import { apiFetch, compactAddress } from "@/lib/api";
import { paymentVaultAbi } from "@/lib/contracts";
import {
  isPermanentAttemptFailure,
  recoveryStep,
  refundIsPermitted,
} from "@/lib/payment-recovery";
import { WalletButton } from "@/components/wallet-button";

type Invoice = {
  id: string;
  slug: string;
  orderId: string;
  amount: string;
  funded: string;
  description?: string;
  expiresAt: string;
  vaultAddress?: string;
  status: string;
  mode: string;
  arcMintTransactionHash?: string | null;
  settlementTransactionHash?: string | null;
  merchant: { displayName?: string; payoutAddress: string };
};
type Quote = {
  quoteId: string;
  requestedAmount: string;
  totalSourceAmount: string;
  maxFee: string;
  finalityThreshold: number;
  transferSpeed: "FAST";
  sourceChainId: number;
  destinationChainId: 5_042_002;
  protocolFeeSubunits: string;
  forwardFeeSubunits: string;
  feeBufferSubunits: string;
  expiresAt: string;
  vaultAddress: string;
  quoteSource: string;
};
type StoredPayment = {
  step: number;
  invoiceId?: string;
  apiAttemptId?: string;
  clientSecret?: string;
  attemptStatus?: string;
  customerAddress?: string;
  refundAddress?: string;
  quoteExpiresAt?: string;
  sourceChainId?: number;
  registeredTransactionHash?: string;
  sourceTransactionHash?: string;
  cctpMessageHash?: string;
  forwardingTransactionHash?: string;
  bridgeResult?: BridgeResult;
  burnObserved?: boolean;
  permanentFailure?: boolean;
  localDemo?: boolean;
  settlementTxHash?: string;
  refundTransactionHash?: string;
  quote?: Quote;
  signature?: `0x${string}`;
  authorization?: {
    attemptId: `0x${string}`;
    sourceChainId: string;
    destinationChainId: string;
    invoiceVault: `0x${string}`;
    orderId: `0x${string}`;
    payer: `0x${string}`;
    refundAddress: `0x${string}`;
    destinationAmount: string;
    maximumSourceAmount: string;
    quoteExpiresAt: string;
    nonce: string;
    attemptExpiresAt: string;
  };
  updatedAt?: string;
};
type StoredAuthorization = NonNullable<StoredPayment["authorization"]>;
type AttemptSnapshot = {
  id: string;
  status: string;
  sourceChainId: number;
  customerAddress: string;
  refundAddress: string | null;
  quoteExpiresAt: string | null;
  registeredTransactionHash: string | null;
  sourceTransactionHash: string | null;
  messageHash: string | null;
  forwardTxHash: string | null;
  bridgeResult: BridgeResult | null;
  bridgeRecoverable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  paymentIntent: {
    status: string;
    arcMintTransactionHash: string | null;
    settlementTransactionHash: string | null;
  };
};

function randomBytes32(): `0x${string}` {
  const value = crypto.getRandomValues(new Uint8Array(32));
  if (value.every((byte) => byte === 0)) value[31] = 1;
  return bytesToHex(value);
}

function serializableBridgeResult(result: BridgeResult): BridgeResult {
  return JSON.parse(
    JSON.stringify(result, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Error)
        return { name: value.name, message: value.message };
      return value;
    }),
  ) as BridgeResult;
}

const paymentAuthorizationTypes = {
  PaymentAuthorization: [
    { name: "attemptId", type: "bytes32" },
    { name: "sourceChainId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "invoiceVault", type: "address" },
    { name: "orderId", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "refundAddress", type: "address" },
    { name: "destinationAmount", type: "uint256" },
    { name: "maximumSourceAmount", type: "uint256" },
    { name: "quoteExpiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "attemptExpiresAt", type: "uint64" },
  ],
} as const;
const steps = [
  "Invoice loaded",
  "Wallet connected",
  "USDC approval",
  "USDC burned on source chain",
  "Circle attestation",
  "USDC minted to Arc vault",
  "Invoice finalized on Arc",
  "Merchant paid",
];

function transactionUrl(chainId: number, hash?: string | null) {
  const explorer = chainsById.get(chainId)?.explorerUrl;
  return explorer && hash ? `${explorer}/tx/${hash}` : null;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PaymentCheckout({ invoiceSlug }: { invoiceSlug: string }) {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const arcPublicClient = usePublicClient({ chainId: arcTestnet.id });
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [sourceChainId, setSourceChainId] = useState<number>(baseSepolia.id);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [refundAddress, setRefundAddress] = useState("");
  const [recoverable, setRecoverable] = useState(false);
  const [storedPayment, setStoredPayment] = useState<StoredPayment | null>(
    null,
  );
  const [savedAttemptId, setSavedAttemptId] = useState("");
  const [attemptSnapshot, setAttemptSnapshot] =
    useState<AttemptSnapshot | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeStep, setActiveStep] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = useMemo(
    () => `arc-checkout-progress:${invoiceSlug}`,
    [invoiceSlug],
  );

  useEffect(() => {
    apiFetch<Invoice>(`/api/payment-intents/${encodeURIComponent(invoiceSlug)}`)
      .then((loaded) => {
        setInvoice(loaded);
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const value = JSON.parse(saved) as StoredPayment;
            if (
              Number.isInteger(value.step) &&
              (value.step ?? 0) >= 1 &&
              (value.step ?? 0) <= steps.length
            )
              setActiveStep(value.step);
            if (value.quote) setQuote(value.quote);
            if (value.sourceChainId) setSourceChainId(value.sourceChainId);
            if (value.refundAddress) setRefundAddress(value.refundAddress);
            setRecoverable(Boolean(value.bridgeResult && value.burnObserved));
            setStoredPayment(value);
            setSavedAttemptId(value.apiAttemptId ?? "");
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Invoice could not be loaded",
        ),
      );
  }, [invoiceSlug, storageKey]);

  useEffect(() => {
    if (!savedAttemptId) return;
    let cancelled = false;

    async function refreshFromBackend() {
      try {
        const remote = await apiFetch<AttemptSnapshot>(
          `/api/payment-attempts/${savedAttemptId}`,
        );
        if (cancelled) return;
        const raw = localStorage.getItem(storageKey);
        const current = raw
          ? (JSON.parse(raw) as StoredPayment)
          : ({ step: 1 } satisfies StoredPayment);
        const step = Math.max(
          current.step,
          recoveryStep(remote.status, remote.paymentIntent.status),
        );
        const next: StoredPayment = {
          ...current,
          step,
          attemptStatus: remote.status,
          customerAddress: remote.customerAddress,
          sourceChainId: remote.sourceChainId,
          burnObserved: Boolean(
            remote.sourceTransactionHash || current.burnObserved,
          ),
          permanentFailure: isPermanentAttemptFailure(
            remote.status,
            remote.bridgeRecoverable,
          ),
          updatedAt: new Date().toISOString(),
          ...(remote.refundAddress
            ? { refundAddress: remote.refundAddress }
            : {}),
          ...(remote.quoteExpiresAt
            ? { quoteExpiresAt: remote.quoteExpiresAt }
            : {}),
          ...(remote.registeredTransactionHash
            ? {
                registeredTransactionHash: remote.registeredTransactionHash,
              }
            : {}),
          ...(remote.sourceTransactionHash
            ? { sourceTransactionHash: remote.sourceTransactionHash }
            : {}),
          ...(remote.messageHash
            ? { cctpMessageHash: remote.messageHash }
            : {}),
          ...(remote.forwardTxHash
            ? { forwardingTransactionHash: remote.forwardTxHash }
            : {}),
          ...(remote.bridgeResult ? { bridgeResult: remote.bridgeResult } : {}),
          ...(remote.paymentIntent.settlementTransactionHash
            ? {
                settlementTxHash:
                  remote.paymentIntent.settlementTransactionHash,
              }
            : {}),
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        setStoredPayment(next);
        setAttemptSnapshot(remote);
        setActiveStep(step);
        setRecoverable(Boolean(remote.bridgeRecoverable && next.bridgeResult));
        setRefundAddress(
          (currentAddress) =>
            currentAddress || remote.refundAddress || remote.customerAddress,
        );
        setInvoice((currentInvoice) =>
          currentInvoice
            ? {
                ...currentInvoice,
                status: remote.paymentIntent.status,
                arcMintTransactionHash:
                  remote.paymentIntent.arcMintTransactionHash,
                settlementTransactionHash:
                  remote.paymentIntent.settlementTransactionHash,
              }
            : currentInvoice,
        );
        setRecoveryError("");
      } catch (caught) {
        if (!cancelled)
          setRecoveryError(
            caught instanceof Error
              ? caught.message
              : "Saved payment could not be reconciled",
          );
      }
    }

    void refreshFromBackend();
    const poll = window.setInterval(() => void refreshFromBackend(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [savedAttemptId, storageKey]);

  useEffect(() => {
    if (isConnected) {
      setActiveStep((step) => Math.max(step, 2));
      setRefundAddress((current) => current || address || "");
    }
  }, [address, isConnected]);

  async function loadQuote() {
    if (!invoice) return;
    setBusy(true);
    setError("");
    try {
      const loadedQuote = await apiFetch<Quote>(
        `/api/payment-intents/${invoice.id}/quote`,
        {
          method: "POST",
          body: JSON.stringify({ sourceChainId }),
        },
      );
      setQuote(loadedQuote);
      savePayment({
        invoiceId: invoice.id,
        sourceChainId,
        quote: loadedQuote,
        quoteExpiresAt: loadedQuote.expiresAt,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Circle quote failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function readPayment(): StoredPayment {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return { step: activeStep };
    try {
      return JSON.parse(saved) as StoredPayment;
    } catch {
      return { step: activeStep };
    }
  }

  function savePayment(
    patch: Partial<StoredPayment> & { step?: number },
  ): StoredPayment {
    const current = readPayment();
    const step = Math.max(current.step ?? 1, patch.step ?? current.step ?? 1);
    const next = {
      ...current,
      ...patch,
      step,
      updatedAt: new Date().toISOString(),
    };
    setActiveStep(step);
    localStorage.setItem(storageKey, JSON.stringify(next));
    setStoredPayment(next);
    setSavedAttemptId(next.apiAttemptId ?? "");
    return next;
  }

  function saveStep(step: number, extra: Partial<StoredPayment> = {}) {
    savePayment({ ...extra, step });
  }

  async function updateAttempt(
    payment: StoredPayment,
    body: Record<string, unknown>,
  ) {
    if (!payment.apiAttemptId || !payment.clientSecret)
      throw new Error("Saved payment attempt credentials are missing");
    return apiFetch(`/api/payment-attempts/${payment.apiAttemptId}/progress`, {
      method: "PATCH",
      headers: { "x-payment-attempt-secret": payment.clientSecret },
      body: JSON.stringify(body),
    });
  }

  async function pay() {
    if (!invoice?.vaultAddress || !quote || !connector || !address) return;
    if (invoice.mode === "demo") {
      setError(
        "Use the labeled local state-machine demo instead of submitting a fake bridge.",
      );
      return;
    }
    if (!isAddress(refundAddress)) {
      setError("Enter a valid EVM refund address before paying.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let payment = readPayment();
      if (payment.burnObserved) {
        setRecoverable(Boolean(payment.bridgeResult));
        throw new Error(
          payment.bridgeResult
            ? "A source burn already exists. Use Resume transfer; a second burn is blocked."
            : "A source burn already exists. Reconciliation will continue without submitting another burn.",
        );
      }
      if (payment.quote && Date.parse(payment.quote.expiresAt) <= Date.now())
        throw new Error(
          "The saved quote expired. Request a fresh quote before any source burn.",
        );

      if (!payment.apiAttemptId) {
        if (Date.parse(quote.expiresAt) <= Date.now())
          throw new Error(
            "The quote expired. Request a new quote before signing.",
          );
        await switchChainAsync({ chainId: arcTestnet.id });
        const attemptId = randomBytes32();
        const nonce = BigInt(randomBytes32());
        const authorization = {
          attemptId,
          sourceChainId: BigInt(sourceChainId),
          destinationChainId: BigInt(arcTestnet.id),
          invoiceVault: invoice.vaultAddress as `0x${string}`,
          orderId: orderIdToBytes32(invoice.orderId),
          payer: address,
          refundAddress,
          destinationAmount: parseUsdc(quote.requestedAmount),
          maximumSourceAmount: parseUsdc(quote.totalSourceAmount),
          quoteExpiresAt: BigInt(
            Math.floor(new Date(quote.expiresAt).getTime() / 1000),
          ),
          nonce,
          attemptExpiresAt: BigInt(
            Math.floor(new Date(invoice.expiresAt).getTime() / 1000),
          ),
        } as const;
        const typedData = {
          domain: {
            name: "Arc Crosschain Checkout",
            version: "1",
            chainId: arcTestnet.id,
            verifyingContract: authorization.invoiceVault,
          },
          types: paymentAuthorizationTypes,
          primaryType: "PaymentAuthorization" as const,
          message: authorization,
        };
        const signature = await signTypedDataAsync(typedData);
        const authorizationDigest = hashTypedData(typedData);
        const created = await apiFetch<{
          id: string;
          clientSecret: string;
        }>(`/api/payment-intents/${invoice.id}/attempts`, {
          method: "POST",
          body: JSON.stringify({
            quoteId: quote.quoteId,
            attemptId,
            invoiceVault: authorization.invoiceVault,
            orderId: invoice.orderId,
            sourceChainId,
            destinationChainId: arcTestnet.id,
            customerAddress: address,
            refundAddress,
            destinationAmount: quote.requestedAmount,
            quotedSourceAmount: quote.totalSourceAmount,
            maximumSourceAmount: quote.totalSourceAmount,
            quoteExpiresAt: quote.expiresAt,
            nonce: nonce.toString(),
            attemptExpiresAt: invoice.expiresAt,
            authorizationDigest,
            signature,
          }),
        });
        payment = savePayment({
          step: 2,
          invoiceId: invoice.id,
          apiAttemptId: created.id,
          clientSecret: created.clientSecret,
          attemptStatus: "QUOTED",
          customerAddress: address,
          refundAddress,
          quoteExpiresAt: quote.expiresAt,
          sourceChainId,
          quote,
          signature,
          authorization: Object.fromEntries(
            Object.entries(authorization).map(([key, value]) => [
              key,
              typeof value === "bigint" ? value.toString() : value,
            ]),
          ) as StoredAuthorization,
        });
      }

      if (!payment.authorization || !payment.signature)
        throw new Error("Saved payment authorization is incomplete");
      if (!payment.quote || !payment.sourceChainId)
        throw new Error("Saved server quote is incomplete");
      if (payment.authorization.payer.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "Reconnect the wallet that signed this payment attempt",
        );
      if (
        BigInt(payment.authorization.sourceChainId) !==
          BigInt(payment.sourceChainId) ||
        BigInt(payment.authorization.destinationAmount) !==
          parseUsdc(payment.quote.requestedAmount) ||
        BigInt(payment.authorization.maximumSourceAmount) !==
          parseUsdc(payment.quote.totalSourceAmount) ||
        payment.authorization.invoiceVault.toLowerCase() !==
          invoice.vaultAddress.toLowerCase()
      )
        throw new Error("Saved payment route does not match its authorization");
      const bridgeQuote = payment.quote;
      const bridgeSourceChainId = payment.sourceChainId;

      if (!payment.registeredTransactionHash) {
        await switchChainAsync({ chainId: arcTestnet.id });
        const stored = payment.authorization;
        const registrationHash = await writeContractAsync({
          address: stored.invoiceVault,
          abi: paymentVaultAbi,
          functionName: "registerPaymentAttempt",
          args: [
            {
              attemptId: stored.attemptId,
              sourceChainId: BigInt(stored.sourceChainId),
              destinationChainId: BigInt(stored.destinationChainId),
              invoiceVault: stored.invoiceVault,
              orderId: stored.orderId,
              payer: stored.payer,
              refundAddress: stored.refundAddress,
              destinationAmount: BigInt(stored.destinationAmount),
              maximumSourceAmount: BigInt(stored.maximumSourceAmount),
              quoteExpiresAt: BigInt(stored.quoteExpiresAt),
              nonce: BigInt(stored.nonce),
              attemptExpiresAt: BigInt(stored.attemptExpiresAt),
            },
            payment.signature,
          ],
          chainId: arcTestnet.id,
        });
        payment = savePayment({
          attemptStatus: "REGISTERED",
          registeredTransactionHash: registrationHash,
        });
      }
      if (!arcPublicClient) throw new Error("Arc RPC client is unavailable");
      const registrationReceipt =
        await arcPublicClient.waitForTransactionReceipt({
          hash: payment.registeredTransactionHash as `0x${string}`,
          confirmations: 1,
        });
      if (registrationReceipt.status !== "success")
        throw new Error("Payment attempt registration reverted on Arc");
      await updateAttempt(payment, {
        status: "REGISTERED",
        registeredTransactionHash: payment.registeredTransactionHash,
      });

      await switchChainAsync({ chainId: bridgeSourceChainId });
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter = await createViemAdapterFromProvider({ provider });
      const kit = new AppKit();
      kit.on("bridge.approve", () => {
        saveStep(3);
        void updateAttempt(payment, {
          status: "APPROVING",
          registeredTransactionHash: payment.registeredTransactionHash,
        }).catch(() => undefined);
      });
      kit.on("bridge.burn", (payload) => {
        if (!payload.values.txHash) return;
        payment = savePayment({
          step: 4,
          attemptStatus: "BURN_SUBMITTED",
          burnObserved: true,
          sourceTransactionHash: payload.values.txHash,
        });
        void updateAttempt(payment, {
          status: "BURN_SUBMITTED",
          registeredTransactionHash: payment.registeredTransactionHash,
          sourceTransactionHash: payload.values.txHash,
        }).catch(() => undefined);
      });
      kit.on("*", (payload) => {
        if (
          "method" in payload &&
          ["attestation", "fetchAttestation"].includes(String(payload.method))
        )
          saveStep(5);
      });
      kit.on("bridge.mint", () => saveStep(6));
      const result = await kit.bridge({
        from: {
          adapter,
          chain:
            bridgeSourceChainId === baseSepolia.id
              ? "Base_Sepolia"
              : "Ethereum_Sepolia",
        },
        to: {
          recipientAddress: invoice.vaultAddress,
          chain: "Arc_Testnet",
          useForwarder: true,
        },
        amount: bridgeQuote.totalSourceAmount,
        config: {
          transferSpeed: bridgeQuote.transferSpeed,
          maxFee: bridgeQuote.maxFee,
          batchTransactions: false,
        },
      });
      const persistedResult = serializableBridgeResult(result);
      const burn = result.steps.find(
        (step) =>
          step.name.toLowerCase() === "burn" &&
          step.state === "success" &&
          step.txHash,
      );
      const sourceTransactionHash =
        burn?.txHash ?? payment.sourceTransactionHash;
      if (sourceTransactionHash) {
        const needsRecovery = result.state !== "success" && Boolean(burn);
        payment = savePayment({
          step: needsRecovery ? 4 : 5,
          attemptStatus: needsRecovery ? "RECOVERABLE" : "BURN_SUBMITTED",
          burnObserved: true,
          sourceTransactionHash,
          bridgeResult: persistedResult,
        });
        await updateAttempt(payment, {
          status: needsRecovery ? "RECOVERABLE" : "BURN_SUBMITTED",
          registeredTransactionHash: payment.registeredTransactionHash,
          sourceTransactionHash,
          bridgeResult: persistedResult,
          ...(needsRecovery
            ? {
                errorCode: "APP_KIT_RECOVERY_REQUIRED",
                errorMessage: "Resume the persisted bridge result",
              }
            : {}),
        });
        setRecoverable(needsRecovery);
      }
      if (result.state !== "success")
        throw new Error(
          "The source burn is saved. Resume this exact transfer; no second burn will be submitted.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Payment could not be completed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resumeTransfer() {
    if (!connector || !address) return;
    const payment = readPayment();
    const successfulBurn = payment.bridgeResult?.steps.find(
      (step) =>
        step.name.toLowerCase() === "burn" &&
        step.state === "success" &&
        step.txHash?.toLowerCase() ===
          payment.sourceTransactionHash?.toLowerCase(),
    );
    if (
      !payment.bridgeResult ||
      !payment.sourceChainId ||
      !payment.sourceTransactionHash ||
      !successfulBurn
    ) {
      setError(
        "Safe retry is unavailable because no persisted successful burn result was found. Reconciliation will keep monitoring the recorded transaction.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await switchChainAsync({ chainId: payment.sourceChainId });
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter = await createViemAdapterFromProvider({ provider });
      const kit = new AppKit();
      kit.on("*", (payload) => {
        if (
          "method" in payload &&
          ["attestation", "fetchAttestation"].includes(String(payload.method))
        )
          saveStep(5);
      });
      kit.on("bridge.mint", () => saveStep(6));
      const result = await kit.retryBridge(payment.bridgeResult, {
        from: adapter,
      });
      const persistedResult = serializableBridgeResult(result);
      const stillRecoverable = result.state !== "success";
      const updated = savePayment({
        step: stillRecoverable ? 5 : 6,
        attemptStatus: stillRecoverable ? "RECOVERABLE" : "BURN_SUBMITTED",
        bridgeResult: persistedResult,
      });
      await updateAttempt(updated, {
        status: stillRecoverable ? "RECOVERABLE" : "BURN_SUBMITTED",
        registeredTransactionHash: updated.registeredTransactionHash,
        sourceTransactionHash: updated.sourceTransactionHash,
        bridgeResult: persistedResult,
        ...(stillRecoverable
          ? {
              errorCode: "APP_KIT_RECOVERY_REQUIRED",
              errorMessage: "Persisted bridge retry is still pending",
            }
          : {}),
      });
      setRecoverable(stillRecoverable);
      if (stillRecoverable)
        throw new Error(
          "The same transfer is still pending. Its recovery state was saved again.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Bridge recovery failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function simulateDemo() {
    if (!invoice || !address) return;
    setBusy(true);
    setError("");
    try {
      const attempt = await apiFetch<{ id: string }>(
        `/api/payment-intents/${invoice.id}/demo-attempts`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceChainId,
            customerAddress: address,
          }),
        },
      );
      savePayment({
        apiAttemptId: attempt.id,
        attemptStatus: "QUOTED",
        customerAddress: address,
        refundAddress: address,
        sourceChainId,
        localDemo: true,
      });
      const statusToStep: Record<string, number> = {
        QUOTED: 2,
        APPROVING: 3,
        BURN_SUBMITTED: 4,
        SOURCE_CONFIRMED: 4,
        ATTESTING: 5,
        ARC_MINTED: 6,
        SETTLING: 7,
        SETTLED: 8,
      };
      const poll = window.setInterval(() => {
        void apiFetch<{ status: string }>(`/api/payment-attempts/${attempt.id}`)
          .then((current) => {
            saveStep(statusToStep[current.status] ?? 2, { localDemo: true });
            if (current.status === "SETTLED" || current.status === "FAILED") {
              window.clearInterval(poll);
              setBusy(false);
            }
          })
          .catch(() => {
            window.clearInterval(poll);
            setBusy(false);
          });
      }, 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local demo failed");
      setBusy(false);
    }
  }

  async function finalize() {
    if (!invoice?.vaultAddress || invoice.mode === "demo") return;
    setBusy(true);
    setError("");
    try {
      if (chainId !== arcTestnet.id)
        await switchChainAsync({ chainId: arcTestnet.id });
      const hash = await writeContractAsync({
        address: invoice.vaultAddress as `0x${string}`,
        abi: paymentVaultAbi,
        functionName: "settle",
        chainId: arcTestnet.id,
      });
      saveStep(7, { settlementTxHash: hash });
      setNotice(
        "Settlement was submitted on Arc. Backend reconciliation will verify finality.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  }

  async function requestRefund() {
    if (!invoice?.vaultAddress || invoice.mode === "demo") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (chainId !== arcTestnet.id)
        await switchChainAsync({ chainId: arcTestnet.id });
      const hash = await writeContractAsync({
        address: invoice.vaultAddress as `0x${string}`,
        abi: paymentVaultAbi,
        functionName: "refund",
        chainId: arcTestnet.id,
      });
      savePayment({ refundTransactionHash: hash });
      setNotice(
        "Refund was submitted to the customer-authorized Arc address. Backend reconciliation will verify it.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  }

  function resetExpiredPreBurnAttempt() {
    const current = readPayment();
    if (current.burnObserved || current.registeredTransactionHash) {
      setError(
        "This attempt is already registered or burned and cannot be replaced from the browser.",
      );
      return;
    }
    const savedCustomerAddress = current.customerAddress ?? address;
    const savedRefundAddress = current.refundAddress ?? refundAddress;
    const next: StoredPayment = {
      step: Math.max(2, current.step),
      ...(invoice?.id ? { invoiceId: invoice.id } : {}),
      ...(savedCustomerAddress
        ? { customerAddress: savedCustomerAddress }
        : {}),
      ...(savedRefundAddress ? { refundAddress: savedRefundAddress } : {}),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey, JSON.stringify(next));
    setStoredPayment(next);
    setSavedAttemptId("");
    setAttemptSnapshot(null);
    setQuote(null);
    setRecoverable(false);
    setRecoveryError("");
    setNotice(
      "The expired pre-burn attempt was cleared. Request a fresh quote.",
    );
  }

  if (!invoice)
    return (
      <div className="page-shell">
        <div className="card">{error || "Loading verified invoice…"}</div>
      </div>
    );
  const sourceTransactionHash =
    attemptSnapshot?.sourceTransactionHash ??
    storedPayment?.sourceTransactionHash;
  const sourceTransactionUrl = transactionUrl(
    attemptSnapshot?.sourceChainId ??
      storedPayment?.sourceChainId ??
      sourceChainId,
    sourceTransactionHash,
  );
  const arcTransactionHash =
    invoice.settlementTransactionHash ??
    storedPayment?.settlementTxHash ??
    invoice.arcMintTransactionHash ??
    attemptSnapshot?.forwardTxHash ??
    storedPayment?.forwardingTransactionHash ??
    storedPayment?.registeredTransactionHash;
  const arcTransactionUrl = transactionUrl(arcTestnet.id, arcTransactionHash);
  const refundAllowed = Boolean(
    storedPayment?.apiAttemptId &&
    refundIsPermitted(invoice.status, invoice.expiresAt),
  );
  const attemptStatus =
    attemptSnapshot?.status ?? storedPayment?.attemptStatus ?? null;
  const quoteExpired = Boolean(
    quote && Date.parse(quote.expiresAt) <= Date.now(),
  );
  return (
    <div className="page-shell">
      <div className="pay-layout">
        <section className="card invoice-card">
          <div className="merchant-line">
            <div>
              <div className="section-kicker">PAYMENT REQUEST</div>
              <h1>{invoice.merchant.displayName ?? "Arc merchant"}</h1>
            </div>
            <span
              className={`status-badge ${invoice.status === "OPEN" ? "pending" : ""}`}
            >
              {invoice.status}
            </span>
          </div>
          {invoice.mode === "demo" && (
            <div className="demo-banner">
              Local demo invoice — it exercises the same lifecycle and never
              emits fake blockchain hashes.
            </div>
          )}
          <div className="amount-due">
            <span>Amount due</span>
            <strong>
              {invoice.amount} <small>USDC</small>
            </strong>
            <p>{invoice.description}</p>
          </div>
          <div className="details-list">
            <div>
              <span>Order reference</span>
              <strong>{invoice.orderId}</strong>
            </div>
            <div>
              <span>Destination network</span>
              <strong>Arc Testnet</strong>
            </div>
            <div>
              <span>Invoice vault</span>
              <strong className="tx-link">
                {compactAddress(invoice.vaultAddress)}
              </strong>
            </div>
            <div>
              <span>Expires</span>
              <strong>{formatTimestamp(invoice.expiresAt)}</strong>
            </div>
            <div>
              <span>Refunds</span>
              <strong>Arc address only (MVP)</strong>
            </div>
          </div>
          <div className="payment-actions">
            <WalletButton />
            <div className="field full">
              <label htmlFor="refund-address">Refund address on Arc</label>
              <input
                id="refund-address"
                value={refundAddress}
                disabled={Boolean(savedAttemptId)}
                onChange={(event) => setRefundAddress(event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">
                Confirm this carefully. Any excess or refund is sent here on
                Arc.
              </p>
            </div>
            <div className="chain-choice">
              <button
                type="button"
                className={sourceChainId === baseSepolia.id ? "selected" : ""}
                disabled={Boolean(savedAttemptId)}
                onClick={() => {
                  setSourceChainId(baseSepolia.id);
                  setQuote(null);
                }}
              >
                Base Sepolia
              </button>
              <button
                type="button"
                className={sourceChainId === sepolia.id ? "selected" : ""}
                disabled={Boolean(savedAttemptId)}
                onClick={() => {
                  setSourceChainId(sepolia.id);
                  setQuote(null);
                }}
              >
                Ethereum Sepolia
              </button>
            </div>
            {!quote ? (
              <button
                className="button primary"
                type="button"
                disabled={!isConnected || busy}
                onClick={() => {
                  void loadQuote();
                }}
              >
                {busy ? "Getting quote…" : "Review fees"}
              </button>
            ) : (
              <>
                <div className="quote-box">
                  <div>
                    <span>Merchant receives</span>
                    <strong>{invoice.amount} USDC</strong>
                  </div>
                  <div>
                    <span>CCTP protocol fee</span>
                    <strong>
                      {Number(quote.protocolFeeSubunits) / 1e6} USDC
                    </strong>
                  </div>
                  <div>
                    <span>Forwarding + safety buffer</span>
                    <strong>
                      {(Number(quote.forwardFeeSubunits) +
                        Number(quote.feeBufferSubunits)) /
                        1e6}{" "}
                      USDC
                    </strong>
                  </div>
                  <div>
                    <span>Total source spend</span>
                    <strong>{quote.totalSourceAmount} USDC</strong>
                  </div>
                  <div>
                    <span>Quote source</span>
                    <strong>{quote.quoteSource}</strong>
                  </div>
                </div>
                {invoice.mode === "demo" ? (
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void simulateDemo();
                    }}
                  >
                    {busy
                      ? "Running local lifecycle…"
                      : "Run local state-machine demo"}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    type="button"
                    disabled={
                      busy ||
                      quoteExpired ||
                      Boolean(storedPayment?.permanentFailure)
                    }
                    onClick={() => {
                      void pay();
                    }}
                  >
                    {quoteExpired
                      ? "Quote expired"
                      : busy
                        ? "Payment in progress…"
                        : savedAttemptId && !storedPayment?.burnObserved
                          ? "Resume payment"
                          : `Pay ${quote.totalSourceAmount} USDC`}
                  </button>
                )}
              </>
            )}
            {quoteExpired &&
              attemptStatus === "QUOTED" &&
              !storedPayment?.registeredTransactionHash &&
              !storedPayment?.burnObserved && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={resetExpiredPreBurnAttempt}
                  type="button"
                >
                  Request a fresh quote
                </button>
              )}
            {recoverable && invoice.mode !== "demo" && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void resumeTransfer();
                }}
              >
                {busy ? "Retrying saved transfer…" : "Retry Circle bridge"}
              </button>
            )}
            {activeStep >= 6 && activeStep < 7 && invoice.mode !== "demo" && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  void finalize();
                }}
              >
                Finalize on Arc
              </button>
            )}
            {refundAllowed && invoice.mode !== "demo" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void requestRefund()}
                type="button"
              >
                Request refund on Arc
              </button>
            )}
            {(sourceTransactionUrl || arcTransactionUrl) && (
              <div className="recovery-actions">
                {sourceTransactionUrl && (
                  <a
                    className="button secondary"
                    href={sourceTransactionUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View source <ExternalLink size={13} />
                  </a>
                )}
                {arcTransactionUrl && (
                  <a
                    className="button secondary"
                    href={arcTransactionUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View on ArcScan <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            {["SETTLED", "REFUNDED"].includes(invoice.status) && (
              <Link
                className="button secondary"
                href={`/receipts/${encodeURIComponent(invoice.slug)}`}
              >
                Open verified receipt
              </Link>
            )}
            {storedPayment?.permanentFailure && (
              <div className="message error" role="alert">
                This attempt is permanently failed. No second burn will be
                submitted. Use the recorded transactions or request a refund
                when the vault permits it.
              </div>
            )}
            {recoveryError && (
              <div className="message error" role="alert">
                Backend recovery: {recoveryError}
              </div>
            )}
            {notice && (
              <div className="message success" role="status">
                {notice}
              </div>
            )}
            {error && (
              <div className="message error" role="alert">
                {error}
              </div>
            )}
          </div>
        </section>
        <aside className="card">
          <div className="section-kicker">PAYMENT PROGRESS</div>
          <h2>Track every hop</h2>
          <ol className="timeline">
            {steps.map((step, index) => (
              <li key={step} className={index + 1 <= activeStep ? "done" : ""}>
                {step}
              </li>
            ))}
          </ol>
          <p className="page-subtitle">
            Attestation delays are recoverable. Progress is saved on this device
            without storing wallet credentials.
          </p>
          {savedAttemptId && (
            <div className="recovery-panel" aria-live="polite">
              <div className="section-kicker">RECOVERED BACKEND STATE</div>
              <div>
                <span>Attempt</span>
                <strong>{compactAddress(savedAttemptId)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{attemptStatus ?? "Syncing…"}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>
                  {compactAddress(
                    attemptSnapshot?.customerAddress ??
                      storedPayment?.customerAddress,
                  )}
                </strong>
              </div>
              <div>
                <span>Refund</span>
                <strong>
                  {compactAddress(
                    attemptSnapshot?.refundAddress ??
                      storedPayment?.refundAddress,
                  )}
                </strong>
              </div>
              <div>
                <span>Quote expiry</span>
                <strong>
                  {storedPayment?.quoteExpiresAt
                    ? formatTimestamp(storedPayment.quoteExpiresAt)
                    : "Pending"}
                </strong>
              </div>
              <div>
                <span>CCTP message</span>
                <strong>
                  {compactAddress(
                    attemptSnapshot?.messageHash ??
                      storedPayment?.cctpMessageHash,
                  )}
                </strong>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
