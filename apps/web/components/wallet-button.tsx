"use client";

import { Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { compactAddress } from "@/lib/api";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected)
    return (
      <button
        className="wallet-button connected"
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
      >
        <span className="status-dot" />
        {compactAddress(address)}
      </button>
    );
  return (
    <button
      className="wallet-button"
      disabled={isPending || connectors.length === 0}
      onClick={() => connectors[0] && connect({ connector: connectors[0] })}
    >
      <Wallet size={16} />
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
