export type WalletConnectorDescriptor = {
  id: string;
  name: string;
  type: string;
  icon?: string | undefined;
};

export type WalletPublicConfig = {
  canonicalAppUrl: string | null;
  productIconUrl: string | null;
  projectId: string | null;
  walletConnectEnabled: boolean;
  issues: string[];
};

const walletConnectProjectIdPattern = /^[a-fA-F0-9]{32}$/;

export function resolveWalletPublicConfig(input: {
  appUrl?: string | undefined;
  projectId?: string | undefined;
  production: boolean;
}): WalletPublicConfig {
  const issues: string[] = [];
  const rawAppUrl = input.appUrl?.trim();
  let canonicalAppUrl: string | null = null;
  let productIconUrl: string | null = null;

  if (!rawAppUrl) {
    if (input.production) {
      issues.push("NEXT_PUBLIC_APP_URL is required in production.");
    } else {
      canonicalAppUrl = "http://localhost:3000";
      productIconUrl = "http://localhost:3000/icon.svg";
    }
  } else {
    try {
      const parsed = new URL(rawAppUrl);
      const localDevelopment =
        !input.production &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !localDevelopment) {
        issues.push("NEXT_PUBLIC_APP_URL must use HTTPS outside local development.");
      } else if (parsed.username || parsed.password) {
        issues.push("NEXT_PUBLIC_APP_URL must not contain credentials.");
      } else {
        canonicalAppUrl = parsed.origin;
        productIconUrl = new URL("/icon.svg", parsed.origin).href;
      }
    } catch {
      issues.push("NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
    }
  }

  const rawProjectId = input.projectId?.trim();
  const projectId = rawProjectId && walletConnectProjectIdPattern.test(rawProjectId)
    ? rawProjectId
    : null;
  if (!rawProjectId) {
    issues.push("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured.");
  } else if (!projectId) {
    issues.push("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is malformed.");
  }

  if (
    input.production &&
    productIconUrl &&
    !productIconUrl.startsWith("https://")
  ) {
    issues.push("WalletConnect product metadata icon must use HTTPS.");
  }

  return {
    canonicalAppUrl,
    productIconUrl,
    projectId,
    walletConnectEnabled: Boolean(
      projectId && canonicalAppUrl && productIconUrl && issues.length === 0,
    ),
    issues,
  };
}

export function isWalletConnectConnector(
  connector: WalletConnectorDescriptor,
): boolean {
  return (
    connector.type.toLowerCase() === "walletconnect" ||
    connector.id.toLowerCase() === "walletconnect"
  );
}

export function isInjectedConnector(
  connector: WalletConnectorDescriptor,
): boolean {
  return connector.type.toLowerCase() === "injected";
}

function isGenericInjected(connector: WalletConnectorDescriptor): boolean {
  return (
    connector.id.toLowerCase() === "injected" ||
    connector.name.toLowerCase() === "injected"
  );
}

export function selectUsableConnectors<T extends WalletConnectorDescriptor>(
  connectors: readonly T[],
  availability: Readonly<Record<string, boolean>>,
): T[] {
  const hasSpecificInjected = connectors.some(
    (connector) =>
      isInjectedConnector(connector) &&
      !isGenericInjected(connector) &&
      availability[connector.id],
  );
  const identities = new Set<string>();

  return connectors.filter((connector) => {
    if (isInjectedConnector(connector) && !availability[connector.id])
      return false;
    if (
      hasSpecificInjected &&
      isInjectedConnector(connector) &&
      isGenericInjected(connector)
    )
      return false;

    const identity = isWalletConnectConnector(connector)
      ? "walletconnect"
      : `${connector.type}:${connector.id}:${connector.name}`.toLowerCase();
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

export function walletConnectorTitle(
  connector: WalletConnectorDescriptor,
): string {
  if (isWalletConnectConnector(connector)) return "WalletConnect";
  if (isGenericInjected(connector)) return "Browser wallet";
  return connector.name;
}

export function walletConnectorDescription(
  connector: WalletConnectorDescriptor,
): string {
  if (isWalletConnectConnector(connector))
    return "Scan a QR code or continue in a supported mobile wallet.";
  if (isGenericInjected(connector))
    return "Connect MetaMask, Rabby, Coinbase Wallet, or another installed wallet.";
  return "Detected browser wallet extension.";
}

export function friendlyWalletError(error: unknown): string {
  const candidate = error as { code?: number; name?: string; message?: string };
  const name = candidate?.name?.toLowerCase() ?? "";
  const message = candidate?.message?.toLowerCase() ?? "";

  if (
    candidate?.code === 4001 ||
    name.includes("userrejected") ||
    message.includes("user rejected") ||
    message.includes("user denied")
  )
    return "Connection request was rejected.";
  if (
    name.includes("providernotfound") ||
    message.includes("provider not found") ||
    message.includes("no provider")
  )
    return "No browser wallet was detected.";
  if (message.includes("project id") || message.includes("projectid"))
    return "WalletConnect is not configured correctly for this deployment.";
  if (message.includes("relay") || message.includes("socket"))
    return "WalletConnect could not reach the relay.";
  if (name.includes("timeout") || message.includes("expired"))
    return "The connection request expired. Please try again.";
  if (
    name.includes("chainnotconfigured") ||
    message.includes("unsupported chain") ||
    message.includes("does not support the requested chain")
  )
    return "This wallet does not support the requested network.";
  return "Wallet connection failed. Check the wallet and try again.";
}
