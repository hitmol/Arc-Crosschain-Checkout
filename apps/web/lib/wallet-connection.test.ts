import { describe, expect, it } from "vitest";
import {
  friendlyWalletError,
  resolveWalletPublicConfig,
  selectUsableConnectors,
  walletConnectorTitle,
} from "./wallet-connection";

const genericInjected = {
  id: "injected",
  name: "Injected",
  type: "injected",
};
const metamask = {
  id: "io.metamask",
  name: "MetaMask",
  type: "injected",
};
const duplicateMetamask = { ...metamask };
const walletConnect = {
  id: "walletConnect",
  name: "WalletConnect",
  type: "walletConnect",
};

describe("wallet public configuration", () => {
  it("enables WalletConnect only with valid production metadata", () => {
    const config = resolveWalletPublicConfig({
      appUrl: "https://pay.example/ignored-path",
      projectId: "a".repeat(32),
      production: true,
    });

    expect(config.walletConnectEnabled).toBe(true);
    expect(config.canonicalAppUrl).toBe("https://pay.example");
    expect(config.productIconUrl).toBe("https://pay.example/icon.svg");
    expect(config.issues).toEqual([]);
  });

  it("never invents a project ID and rejects malformed production metadata", () => {
    const missing = resolveWalletPublicConfig({
      appUrl: "http://pay.example",
      production: true,
    });
    const malformed = resolveWalletPublicConfig({
      appUrl: "https://pay.example",
      projectId: "placeholder",
      production: true,
    });

    expect(missing.walletConnectEnabled).toBe(false);
    expect(missing.projectId).toBeNull();
    expect(missing.issues.join(" ")).toMatch(/HTTPS/);
    expect(malformed.walletConnectEnabled).toBe(false);
    expect(malformed.issues.join(" ")).toMatch(/malformed/);
  });
});

describe("wallet connector selection", () => {
  it("does not use an unavailable injected connector", () => {
    expect(
      selectUsableConnectors([genericInjected, walletConnect], {
        injected: false,
        walletConnect: true,
      }),
    ).toEqual([walletConnect]);
  });

  it("deduplicates EIP-6963 wallets and suppresses the generic duplicate", () => {
    expect(
      selectUsableConnectors(
        [genericInjected, metamask, duplicateMetamask, walletConnect],
        {
          injected: true,
          "io.metamask": true,
          walletConnect: true,
        },
      ),
    ).toEqual([metamask, walletConnect]);
  });

  it("labels a generic injected provider as a browser wallet", () => {
    expect(walletConnectorTitle(genericInjected)).toBe("Browser wallet");
  });
});

describe("wallet error messages", () => {
  it.each([
    [{ code: 4001 }, "Connection request was rejected."],
    [{ name: "ProviderNotFoundError" }, "No browser wallet was detected."],
    [
      { message: "relay socket closed" },
      "WalletConnect could not reach the relay.",
    ],
    [
      { name: "TimeoutError" },
      "The connection request expired. Please try again.",
    ],
  ])("maps connection failures without exposing internals", (error, expected) => {
    expect(friendlyWalletError(error)).toBe(expected);
  });
});
