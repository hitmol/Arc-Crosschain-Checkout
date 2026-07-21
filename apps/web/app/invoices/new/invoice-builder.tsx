"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  keccak256,
  toBytes,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
} from "viem";
import { arcTestnet } from "viem/chains";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { CopyButton } from "@/components/copy-button";
import { checkoutFactoryAbi, merchantRegistryAbi } from "@/lib/contracts";
import { arcDeployment, ARC_EXPLORER } from "@/lib/deployment";
import {
  assertOrderIdAvailable,
  friendlyContractError,
  invoicePath,
  upsertLocalInvoice,
  validateInvoiceInput,
  validatePayoutAddress,
  type LocalInvoice,
} from "@/lib/onchain-invoices";
import {
  factoryAddress,
  isRegisteredMerchant,
  readMerchant,
  recoverPendingInvoices,
  registryAddress,
  verifyOnchainDeployment,
  type MerchantRecord,
} from "@/lib/onchain-runtime";

type Lifecycle =
  | "idle"
  | "preparing"
  | "ready"
  | "awaiting-wallet"
  | "submitted"
  | "confirming"
  | "created"
  | "failed";

type PreparedInvoice = {
  orderReference: string;
  orderId: Hash;
  amount: string;
  amountUnits: bigint;
  expiresAt: number;
  metadataHash: Hash;
  predictedVault: Address;
  estimatedGas: bigint;
};

const expiryPresets = [
  { label: "30 minutes", value: "1800" },
  { label: "1 hour", value: "3600" },
  { label: "24 hours", value: "86400" },
  { label: "7 days", value: "604800" },
  { label: "Custom date and time", value: "custom" },
] as const;

export function InvoiceBuilder() {
  const router = useRouter();
  const account = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const [switching, setSwitching] = useState(false);
  const [merchant, setMerchant] = useState<MerchantRecord | null>(null);
  const [merchantLoading, setMerchantLoading] = useState(false);
  const [payout, setPayout] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [registrationResult, setRegistrationResult] = useState<{
    hash: Hash;
    block: bigint;
    payout: Address;
  } | null>(null);
  const [orderReference, setOrderReference] = useState("");
  const [amount, setAmount] = useState("0.10");
  const [description, setDescription] = useState("");
  const [expiryPreset, setExpiryPreset] = useState("3600");
  const [customExpiry, setCustomExpiry] = useState("");
  const [prepared, setPrepared] = useState<PreparedInvoice | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle>("idle");
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [error, setError] = useState("");

  const connectedAddress = account.address ? getAddress(account.address) : null;
  const registered = Boolean(
    connectedAddress &&
    merchant &&
    isRegisteredMerchant(merchant, connectedAddress),
  );
  const expiresAt = useMemo(() => {
    if (expiryPreset === "custom") {
      const parsed = Date.parse(customExpiry);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
    }
    return Math.floor(Date.now() / 1_000) + Number(expiryPreset);
  }, [customExpiry, expiryPreset]);

  const refreshMerchant = useCallback(async () => {
    if (!publicClient || !connectedAddress) {
      setMerchant(null);
      return;
    }
    setMerchantLoading(true);
    try {
      await verifyOnchainDeployment(publicClient);
      const record = await readMerchant(publicClient, connectedAddress);
      setMerchant(record);
      setPayout((current) => current || connectedAddress);
    } catch (caught) {
      setError(friendlyContractError(caught));
    } finally {
      setMerchantLoading(false);
    }
  }, [connectedAddress, publicClient]);

  useEffect(() => {
    setPrepared(null);
    setRegistrationResult(null);
    setError("");
    void refreshMerchant();
    if (publicClient && typeof window !== "undefined")
      void recoverPendingInvoices(publicClient, window.localStorage);
  }, [publicClient, refreshMerchant]);

  async function requireArcWalletChain() {
    const connector = account.connector;
    if (!connector) throw new Error("Reconnect the wallet before continuing");
    const provider = (await connector.getProvider()) as {
      request(args: {
        method: string;
        params?: readonly unknown[];
      }): Promise<unknown>;
    };
    const readProviderChainId = async () => {
      const value = await provider.request({ method: "eth_chainId" });
      const parsed =
        typeof value === "string" ? Number.parseInt(value, 16) : Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error("The wallet returned an invalid chain ID");
      return parsed;
    };
    let walletChainId = await readProviderChainId();
    if (walletChainId !== arcTestnet.id) {
      const chainIdHex = `0x${arcTestnet.id.toString(16)}`;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (caught) {
        const code =
          typeof caught === "object" && caught
            ? (caught as { code?: unknown }).code
            : undefined;
        if (code !== 4902 && code !== "4902") throw caught;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: arcTestnet.name,
              nativeCurrency: arcTestnet.nativeCurrency,
              rpcUrls: [...arcTestnet.rpcUrls.default.http],
              blockExplorerUrls: arcTestnet.blockExplorers?.default.url
                ? [arcTestnet.blockExplorers.default.url]
                : [],
            },
          ],
        });
      }
      walletChainId = await readProviderChainId();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (walletChainId !== arcTestnet.id)
      throw new Error(
        `The wallet is still on chain ${walletChainId}. Switch it to Arc Testnet ${arcTestnet.id}.`,
      );
  }

  async function switchToArc(): Promise<boolean> {
    setError("");
    setSwitching(true);
    try {
      await requireArcWalletChain();
      return true;
    } catch (caught) {
      setError(
        `${friendlyContractError(caught)} If Arc is not listed, approve the wallet's add-network request.`,
      );
      return false;
    } finally {
      setSwitching(false);
    }
  }

  async function registerMerchant() {
    if (!publicClient || !connectedAddress) return;
    setError("");
    try {
      await requireArcWalletChain();
      const current = await readMerchant(publicClient, connectedAddress);
      if (current.owner !== zeroAddress) {
        setMerchant(current);
        if (current.active) return;
        throw new Error(
          "This merchant is registered but inactive. Reactivate it from the registry before creating invoices.",
        );
      }
      await verifyOnchainDeployment(publicClient);
      const payoutAddress = validatePayoutAddress(payout || connectedAddress);
      const metadataHash = businessName.trim()
        ? keccak256(toBytes(businessName.trim()))
        : zeroHash;
      await publicClient.simulateContract({
        account: connectedAddress,
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: "registerMerchant",
        args: [payoutAddress, metadataHash],
      });
      await publicClient.estimateContractGas({
        account: connectedAddress,
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: "registerMerchant",
        args: [payoutAddress, metadataHash],
      });
      setLifecycle("awaiting-wallet");
      const hash = await writeContractAsync({
        account: connectedAddress,
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: "registerMerchant",
        args: [payoutAddress, metadataHash],
        chainId: arcTestnet.id,
      });
      setTransactionHash(hash);
      setLifecycle("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success")
        throw new Error("Merchant registration reverted on Arc");
      const event = receipt.logs.flatMap((log) => {
        if (!isAddressEqual(log.address, registryAddress)) return [];
        try {
          const decoded = decodeEventLog({
            abi: merchantRegistryAbi,
            data: log.data,
            topics: log.topics,
            eventName: "MerchantRegistered",
          });
          return [decoded];
        } catch {
          return [];
        }
      })[0];
      if (!event)
        throw new Error(
          "MerchantRegistered was not found in the confirmed receipt",
        );
      setRegistrationResult({
        hash,
        block: receipt.blockNumber,
        payout: payoutAddress,
      });
      await refreshMerchant();
      setLifecycle("idle");
    } catch (caught) {
      setLifecycle("failed");
      setError(friendlyContractError(caught));
    }
  }

  async function prepareInvoice(event: React.FormEvent) {
    event.preventDefault();
    if (!publicClient || !connectedAddress) return;
    setError("");
    setPrepared(null);
    setLifecycle("preparing");
    try {
      await requireArcWalletChain();
      await verifyOnchainDeployment(publicClient);
      const currentMerchant = await readMerchant(
        publicClient,
        connectedAddress,
      );
      if (!isRegisteredMerchant(currentMerchant, connectedAddress))
        throw new Error(
          "Register an active merchant before creating an invoice",
        );
      const validated = validateInvoiceInput({
        orderReference,
        amount,
        expiresAt,
      });
      const existingVault = (await publicClient.readContract({
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "vaultByOrderId",
        args: [connectedAddress, validated.orderId],
      })) as Address;
      assertOrderIdAvailable(existingVault);
      const predictedVault = getAddress(
        String(
          await publicClient.readContract({
            address: factoryAddress,
            abi: checkoutFactoryAbi,
            functionName: "predictPaymentVault",
            args: [connectedAddress, validated.orderId],
          }),
        ),
      );
      const metadataHash = description.trim()
        ? keccak256(toBytes(description.trim()))
        : zeroHash;
      const contractArgs = [
        validated.orderId,
        validated.amountUnits,
        BigInt(validated.expiresAt),
        metadataHash,
      ] as const;
      await publicClient.simulateContract({
        account: connectedAddress,
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "createPaymentIntent",
        args: contractArgs,
      });
      const estimatedGas = await publicClient.estimateContractGas({
        account: connectedAddress,
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "createPaymentIntent",
        args: contractArgs,
      });
      setPrepared({ ...validated, metadataHash, predictedVault, estimatedGas });
      setLifecycle("ready");
    } catch (caught) {
      setLifecycle("failed");
      setError(friendlyContractError(caught));
    }
  }

  async function createInvoice() {
    if (!publicClient || !connectedAddress || !prepared) return;
    setError("");
    try {
      await requireArcWalletChain();
      await verifyOnchainDeployment(publicClient);
      setLifecycle("awaiting-wallet");
      const hash = await writeContractAsync({
        account: connectedAddress,
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "createPaymentIntent",
        args: [
          prepared.orderId,
          prepared.amountUnits,
          BigInt(prepared.expiresAt),
          prepared.metadataHash,
        ],
        chainId: arcTestnet.id,
      });
      setTransactionHash(hash);
      setLifecycle("submitted");
      const pending: LocalInvoice = {
        version: 1,
        merchant: connectedAddress,
        orderReference: prepared.orderReference,
        orderId: prepared.orderId,
        amount: prepared.amount,
        amountUnits: prepared.amountUnits.toString(),
        expiresAt: prepared.expiresAt,
        metadataHash: prepared.metadataHash,
        predictedVault: prepared.predictedVault,
        creationTransaction: hash,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      upsertLocalInvoice(window.localStorage, pending);
      setLifecycle("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      const recovered = await recoverPendingInvoices(
        publicClient,
        window.localStorage,
      );
      const confirmed = recovered.find(
        (entry) =>
          entry.creationTransaction.toLowerCase() === hash.toLowerCase(),
      );
      if (
        receipt.status !== "success" ||
        !confirmed ||
        confirmed.status !== "confirmed"
      )
        throw new Error(
          confirmed?.failure ?? "Invoice receipt could not be verified",
        );
      setLifecycle("created");
      router.push(invoicePath(confirmed));
    } catch (caught) {
      setLifecycle("failed");
      setError(friendlyContractError(caught));
    }
  }

  if (!account.isConnected || !connectedAddress)
    return (
      <div className="page-shell onchain-builder-page">
        <div className="section-kicker">ARC TESTNET BUILDER</div>
        <h1 className="page-title">Create a real onchain invoice.</h1>
        <div className="card empty-state">
          <h2>Connect a wallet to create an Arc Testnet invoice.</h2>
          <p>No API account or merchant database is required.</p>
          <WalletButton />
        </div>
      </div>
    );

  return (
    <div className="page-shell onchain-builder-page">
      <div className="section-heading">
        <div>
          <div className="section-kicker">PUBLIC ONCHAIN BUILDER MODE</div>
          <h1 className="page-title">Create an Arc Testnet invoice.</h1>
          <p className="page-subtitle">
            CheckoutFactory creates a real deterministic vault. The confirmed
            Arc receipt is the source of truth.
          </p>
        </div>
        <Link className="button secondary" href="/dashboard">
          Builder Console
        </Link>
      </div>

      {chainId !== arcTestnet.id && (
        <div className="card action-panel">
          <h2>Switch to Arc Testnet</h2>
          <p>
            Current chain: {chainId}. Required chain: {arcTestnet.id}.
          </p>
          <button
            className="button primary"
            disabled={switching}
            onClick={() => void switchToArc()}
            type="button"
          >
            {switching ? "Waiting for wallet…" : "Switch to Arc Testnet"}
          </button>
        </div>
      )}

      <section
        className="card merchant-panel"
        aria-labelledby="merchant-status-heading"
      >
        <div className="card-heading">
          <div>
            <div className="section-kicker">MERCHANT</div>
            <h2 id="merchant-status-heading">Onchain registration</h2>
          </div>
          {merchantLoading ? <LoaderCircle className="spin" size={18} /> : null}
        </div>
        {registered && merchant ? (
          <div className="details-list">
            <div>
              <span>Merchant wallet</span>
              <strong>{connectedAddress}</strong>
            </div>
            <div>
              <span>Payout address</span>
              <strong>{merchant.payoutAddress}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong className="proof-ok">Active</strong>
            </div>
            <a
              href={`${ARC_EXPLORER}/address/${connectedAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              Open merchant on ArcScan <ExternalLink size={13} />
            </a>
          </div>
        ) : (
          <div className="registration-form">
            <p>
              This wallet is not an active merchant. Registration is a real
              MerchantRegistry transaction.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="businessName">Business label (optional)</label>
                <input
                  id="businessName"
                  maxLength={80}
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="payout">Arc payout address</label>
                <input
                  id="payout"
                  value={payout || connectedAddress}
                  onChange={(event) => setPayout(event.target.value)}
                />
              </div>
            </div>
            <p className="field-hint">
              Network: Arc Testnet · Contract: {registryAddress}
            </p>
            <button
              className="button primary"
              disabled={
                chainId !== arcTestnet.id ||
                lifecycle === "awaiting-wallet" ||
                lifecycle === "confirming"
              }
              onClick={() => void registerMerchant()}
              type="button"
            >
              Register as a merchant
            </button>
          </div>
        )}
        {registrationResult && (
          <div className="message success" role="status">
            MerchantRegistered confirmed in block{" "}
            {registrationResult.block.toString()}. Payout{" "}
            {registrationResult.payout}.{" "}
            <a
              href={`${ARC_EXPLORER}/tx/${registrationResult.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              Open transaction
            </a>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="invoice-form-heading">
        <div className="section-kicker">CHECKOUTFACTORY</div>
        <h2 id="invoice-form-heading">Invoice details</h2>
        <form
          className="form-grid"
          onSubmit={(event) => void prepareInvoice(event)}
        >
          <div className="field">
            <label htmlFor="orderReference">Order reference</label>
            <input
              id="orderReference"
              maxLength={32}
              placeholder="ORDER-2026-001"
              required
              value={orderReference}
              onChange={(event) => setOrderReference(event.target.value)}
            />
            <small>
              Unique per merchant; converted deterministically to bytes32.
            </small>
          </div>
          <div className="field">
            <label htmlFor="invoiceAmount">Amount (USDC)</label>
            <input
              id="invoiceAmount"
              inputMode="decimal"
              pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <small>ERC-20 USDC uses exactly 6 decimals.</small>
          </div>
          <div className="field">
            <label htmlFor="expiryPreset">Expiry</label>
            <select
              id="expiryPreset"
              value={expiryPreset}
              onChange={(event) => setExpiryPreset(event.target.value)}
            >
              {expiryPresets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          {expiryPreset === "custom" && (
            <div className="field">
              <label htmlFor="customExpiry">
                Custom expiry (
                {Intl.DateTimeFormat().resolvedOptions().timeZone})
              </label>
              <input
                id="customExpiry"
                type="datetime-local"
                value={customExpiry}
                onChange={(event) => setCustomExpiry(event.target.value)}
              />
            </div>
          )}
          <div className="field full">
            <label htmlFor="invoiceDescription">Description (optional)</label>
            <textarea
              id="invoiceDescription"
              maxLength={280}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <small>Only its keccak256 hash is stored by CheckoutFactory.</small>
          </div>
          <div className="field full details-list compact-details">
            <div>
              <span>Final Unix expiry</span>
              <strong>{expiresAt || "Choose a valid date"}</strong>
            </div>
            <div>
              <span>Customer refund address</span>
              <strong>Chosen and EIP-712-authorized by the payer later</strong>
            </div>
            <p className="field-hint">
              Direct Arc refunds use the payer-authorized Arc address. Automatic
              crosschain refunds are not promised.
            </p>
          </div>
          <div className="field full form-actions">
            <button
              className="button primary"
              disabled={
                !registered ||
                chainId !== arcTestnet.id ||
                lifecycle === "preparing"
              }
              type="submit"
            >
              {lifecycle === "preparing" ? "Simulating…" : "Review transaction"}
            </button>
          </div>
        </form>
      </section>

      {prepared && (
        <section
          className="card confirmation-card"
          aria-labelledby="confirmation-heading"
        >
          <div className="section-kicker">CONFIRMATION</div>
          <h2 id="confirmation-heading">Review before opening your wallet</h2>
          <div className="details-list">
            <div>
              <span>Network</span>
              <strong>Arc Testnet ({arcTestnet.id})</strong>
            </div>
            <div>
              <span>Contract</span>
              <strong>{factoryAddress}</strong>
            </div>
            <div>
              <span>Merchant</span>
              <strong>{connectedAddress}</strong>
            </div>
            <div>
              <span>Order ID</span>
              <strong>{prepared.orderReference}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>{prepared.amount} USDC</strong>
            </div>
            <div>
              <span>Expiry</span>
              <strong>
                {new Date(prepared.expiresAt * 1_000).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Predicted vault</span>
              <strong>{prepared.predictedVault}</strong>
            </div>
            <div>
              <span>Estimated gas</span>
              <strong>{prepared.estimatedGas.toString()}</strong>
            </div>
          </div>
          <button
            className="button primary"
            disabled={["awaiting-wallet", "submitted", "confirming"].includes(
              lifecycle,
            )}
            onClick={() => void createInvoice()}
            type="button"
          >
            {lifecycle === "awaiting-wallet"
              ? "Awaiting wallet confirmation…"
              : lifecycle === "confirming" || lifecycle === "submitted"
                ? "Confirming on Arc…"
                : "Create invoice on Arc"}
          </button>
        </section>
      )}

      {transactionHash && (
        <div className="message success" role="status">
          Transaction submitted: {transactionHash}{" "}
          <CopyButton label="Transaction hash" value={transactionHash} />{" "}
          <a
            href={`${ARC_EXPLORER}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Open ArcScan
          </a>
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <div className="public-mode-notice">
        Public onchain mode is active. The production API and worker are not
        required for merchant registration or invoice creation. Factory:{" "}
        {arcDeployment.contracts.CheckoutFactory}.
      </div>
    </div>
  );
}
