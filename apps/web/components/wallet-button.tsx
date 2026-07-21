"use client";

import { Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { compactAddress } from "@/lib/api";
import { wagmiConfig } from "@/lib/wagmi";
import { WalletConnectDialog } from "./wallet-connect-dialog";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chain = wagmiConfig.chains.find(
    (candidate) => candidate.id === chainId,
  );

  useEffect(() => setBrowserReady(true), []);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        aria-label={
          isConnected
            ? `Wallet ${compactAddress(address)} connected on ${chain?.name ?? `chain ${chainId}`}. Open wallet details.`
            : "Connect wallet"
        }
        className={`wallet-button ${isConnected ? "connected" : ""}`}
        onClick={() => setDialogOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {isConnected ? <span className="status-dot" /> : <Wallet size={16} />}
        {isConnected ? compactAddress(address) : "Connect wallet"}
      </button>
      {browserReady && (
        <WalletConnectDialog
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
}
