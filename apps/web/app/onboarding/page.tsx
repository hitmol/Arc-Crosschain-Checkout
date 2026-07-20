"use client";

import { useState } from "react";
import { keccak256, toBytes, zeroHash } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { arcTestnet } from "viem/chains";
import { merchantRegistryAbi } from "@/lib/contracts";
import { WalletButton } from "@/components/wallet-button";

const registryAddress = process.env.NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS as
  `0x${string}` | undefined;

export default function OnboardingPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContractAsync,
    data: hash,
    error,
    isPending,
  } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, confirmations: 1 });
  const [payout, setPayout] = useState("");
  const [name, setName] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!address || !registryAddress) return;
    if (chainId !== arcTestnet.id)
      await switchChainAsync({ chainId: arcTestnet.id });
    await writeContractAsync({
      address: registryAddress,
      abi: merchantRegistryAbi,
      functionName: "registerMerchant",
      args: [
        payout as `0x${string}`,
        name ? keccak256(toBytes(name)) : zeroHash,
      ],
      chainId: arcTestnet.id,
    });
  }
  return (
    <div className="page-shell">
      <div className="section-kicker">MERCHANT SETUP</div>
      <h1 className="page-title">Register on Arc.</h1>
      <p className="page-subtitle">
        Your payout address is snapshotted into every new invoice vault.
      </p>
      {!registryAddress && (
        <div className="demo-banner">
          Contract addresses are not configured. Deploy to Arc Testnet and set
          `NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS` to enable onchain
          registration.
        </div>
      )}
      <div className="card">
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="form-grid"
        >
          <div className="field full">
            <label>Connected merchant wallet</label>
            <div>
              <WalletButton />
            </div>
          </div>
          <div className="field">
            <label htmlFor="name">Business name</label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Northstar Supply"
            />
          </div>
          <div className="field">
            <label htmlFor="payout">Arc payout address</label>
            <input
              id="payout"
              value={payout}
              onChange={(event) => setPayout(event.target.value)}
              pattern="0x[a-fA-F0-9]{40}"
              required
              placeholder="0x…"
            />
          </div>
          <div className="field full">
            <p className="page-subtitle">
              Arc uses USDC for gas. The UI never asks for or stores a private
              key.
            </p>
          </div>
          <div className="field full form-actions">
            <button
              className="button primary"
              disabled={!isConnected || !registryAddress || isPending}
            >
              {isPending ? "Confirm in wallet…" : "Register merchant"}
            </button>
          </div>
        </form>
        {error && <div className="message error">{error.message}</div>}
        {receipt.isSuccess && (
          <div className="message success">
            Merchant registered on Arc. Transaction {hash}
          </div>
        )}
      </div>
    </div>
  );
}
