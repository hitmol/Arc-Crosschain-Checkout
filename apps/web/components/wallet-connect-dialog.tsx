"use client";

import {
  CircleAlert,
  Laptop,
  LoaderCircle,
  LogOut,
  QrCode,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import {
  useAccount,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
  type Connector,
} from "wagmi";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { BrandMark } from "./brand-mark";
import { compactAddress } from "@/lib/api";
import { brand } from "@/lib/brand";
import {
  friendlyWalletError,
  isInjectedConnector,
  isWalletConnectConnector,
  selectUsableConnectors,
  walletConnectorDescription,
  walletConnectorTitle,
} from "@/lib/wallet-connection";
import { wagmiConfig, walletPublicConfig } from "@/lib/wagmi";

type WalletConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

function safeWalletIcon(icon?: string): string | null {
  if (!icon) return null;
  if (icon.startsWith("data:image/")) return icon;
  try {
    const parsed = new URL(icon);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function WalletConnectDialog({
  open,
  onOpenChange,
  triggerRef,
}: WalletConnectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const connectors = useConnectors();
  const {
    isPending: connectionPending,
    mutateAsync: connectAsync,
    reset: resetConnection,
  } = useConnect();
  const { isPending: disconnectionPending, mutateAsync: disconnectAsync } =
    useDisconnect();
  const account = useAccount();
  const chainId = useChainId();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState(true);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    setSelectedConnectorId(null);
    resetConnection();
    setDetecting(true);
    void Promise.all(
      connectors.map(async (connector) => {
        if (!isInjectedConnector(connector))
          return [connector.id, true] as const;
        try {
          const provider = await connector.getProvider();
          return [connector.id, Boolean(provider)] as const;
        } catch {
          return [connector.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setAvailability(Object.fromEntries(entries));
      setDetecting(false);
    });
    return () => {
      active = false;
    };
  }, [connectors, open, resetConnection]);

  const usableConnectors = useMemo(
    () => selectUsableConnectors(connectors, availability),
    [availability, connectors],
  );
  const hasInjectedWallet = usableConnectors.some(isInjectedConnector);
  const hasWalletConnect =
    walletPublicConfig.walletConnectEnabled &&
    usableConnectors.some(isWalletConnectConnector);
  const currentChain = wagmiConfig.chains.find((chain) => chain.id === chainId);

  function restoreTriggerFocus() {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function closeDialog() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onOpenChange(false);
    restoreTriggerFocus();
  }

  async function connectConnector(connector: Connector) {
    setError("");
    setSelectedConnectorId(connector.id);
    try {
      await connectAsync({ connector });
      closeDialog();
    } catch (caught) {
      setError(friendlyWalletError(caught));
    } finally {
      setSelectedConnectorId(null);
    }
  }

  async function disconnectWallet() {
    setError("");
    try {
      await disconnectAsync();
      closeDialog();
    } catch {
      setError("Wallet disconnect failed. Please try again.");
    }
  }

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="wallet-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
      onClose={() => {
        onOpenChange(false);
        restoreTriggerFocus();
      }}
      ref={dialogRef}
    >
      <div className="wallet-dialog-panel">
        <header className="wallet-dialog-header">
          <span className="brand compact">
            <BrandMark className="brand-mark" />
            {brand.productName}
          </span>
          <button
            aria-label="Close wallet dialog"
            className="icon-button"
            onClick={closeDialog}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="wallet-dialog-intro">
          <div className="section-kicker">WALLET CONNECTION</div>
          <h2 id={titleId}>
            {account.isConnected ? "Wallet connected" : "Choose a wallet"}
          </h2>
          <p id={descriptionId}>
            {account.isConnected
              ? "Review the active account and network or disconnect safely."
              : "Select an installed browser wallet or use WalletConnect on another device."}
          </p>
        </div>

        {account.isConnected ? (
          <div className="wallet-account-panel">
            <div>
              <span>Account</span>
              <strong>{compactAddress(account.address)}</strong>
            </div>
            <div>
              <span>Connected with</span>
              <strong>{account.connector?.name ?? "Wallet"}</strong>
            </div>
            <div>
              <span>Current network</span>
              <strong>{currentChain?.name ?? `Chain ${chainId}`}</strong>
            </div>
            <p>
              SettleLink requests a network switch only when the selected
              merchant or payment operation requires it.
            </p>
            <button
              className="button secondary wallet-disconnect-button"
              disabled={disconnectionPending}
              onClick={() => void disconnectWallet()}
              type="button"
            >
              {disconnectionPending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <LogOut size={16} />
              )}
              {disconnectionPending ? "Disconnecting…" : "Disconnect wallet"}
            </button>
          </div>
        ) : (
          <>
            <div className="wallet-options" aria-busy={detecting}>
              {usableConnectors.map((connector) => {
                const walletConnect = isWalletConnectConnector(connector);
                const selected = selectedConnectorId === connector.id;
                const icon = safeWalletIcon(connector.icon);
                return (
                  <button
                    className="wallet-option"
                    disabled={connectionPending && selected}
                    key={`${connector.type}:${connector.id}`}
                    onClick={() => void connectConnector(connector)}
                    type="button"
                  >
                    <span className="wallet-option-icon" aria-hidden="true">
                      {selected ? (
                        <LoaderCircle className="spin" size={22} />
                      ) : icon ? (
                        <img alt="" height="24" src={icon} width="24" />
                      ) : walletConnect ? (
                        <QrCode size={22} />
                      ) : (
                        <Wallet size={22} />
                      )}
                    </span>
                    <span>
                      <strong>{walletConnectorTitle(connector)}</strong>
                      <small>{walletConnectorDescription(connector)}</small>
                    </span>
                    <em>
                      {selected
                        ? "Connecting…"
                        : walletConnect
                          ? "QR / mobile"
                          : "Detected"}
                    </em>
                  </button>
                );
              })}

              {!detecting && !hasInjectedWallet && (
                <div className="wallet-option unavailable">
                  <span className="wallet-option-icon" aria-hidden="true">
                    <Laptop size={22} />
                  </span>
                  <span>
                    <strong>Install a browser wallet</strong>
                    <small>
                      No EIP-1193 or EIP-6963 wallet extension was detected.
                    </small>
                  </span>
                  <em>Not detected</em>
                </div>
              )}

              {!hasWalletConnect && (
                <div className="wallet-option unavailable">
                  <span className="wallet-option-icon" aria-hidden="true">
                    <Smartphone size={22} />
                  </span>
                  <span>
                    <strong>WalletConnect unavailable</strong>
                    <small>
                      WalletConnect is not configured for this deployment. Use
                      an installed browser wallet or contact the operator.
                    </small>
                  </span>
                  <em>Unavailable</em>
                </div>
              )}
            </div>

            {error && (
              <div className="wallet-error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button
                  onClick={() => {
                    setError("");
                    resetConnection();
                  }}
                  type="button"
                >
                  Try again
                </button>
              </div>
            )}
            <p className="wallet-status" aria-live="polite" role="status">
              {detecting
                ? "Checking available wallet providers…"
                : connectionPending
                  ? `Waiting for ${selectedConnectorId ?? "wallet"} approval…`
                  : `${usableConnectors.length} wallet option${usableConnectors.length === 1 ? "" : "s"} available.`}
            </p>
          </>
        )}

        <footer className="wallet-dialog-footer">
          <Wallet aria-hidden="true" size={16} />
          <span>
            SettleLink never asks for a recovery phrase or stores wallet keys.
            Built on Arc; crosschain transfers use Circle CCTP.
          </span>
        </footer>
      </div>
    </dialog>
  );
}
