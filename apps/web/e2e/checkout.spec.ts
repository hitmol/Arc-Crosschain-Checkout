import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { keccak256, toBytes } from "viem";

const screenshotDirectory = path.resolve(process.cwd(), "../../evidence/brand");
const walletEvidenceDirectory = path.resolve(
  process.cwd(),
  "../../output/playwright",
);

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
}

const merchant = "0x1111111111111111111111111111111111111111";

const arcMock = {
  rpcUrl: "https://rpc.testnet.arc.network",
  registry: "0x10d4611a4c434d990744bfd043bfacdb6d0edd08",
  factory: "0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e",
  vaultImplementation: "0xd75c73b64485ba0432f6c2f4d0465de2abfa6e74",
  usdc: "0x3600000000000000000000000000000000000000",
  vault: "0x3333333333333333333333333333333333333333",
  registrationHash: `0x${"44".repeat(32)}`,
  creationHash: `0x${"55".repeat(32)}`,
  selectors: Object.fromEntries(
    [
      "merchantOf(address)",
      "merchantRegistry()",
      "usdc()",
      "vaultImplementation()",
      "vaultByOrderId(address,bytes32)",
      "predictPaymentVault(address,bytes32)",
      "registerMerchant(address,bytes32)",
      "createPaymentIntent(bytes32,uint256,uint64,bytes32)",
      "merchant()",
      "payoutAddress()",
      "orderId()",
      "expectedAmount()",
      "currentBalance()",
      "expiresAt()",
      "paymentState()",
      "payer()",
      "payerRefundAddress()",
    ].map((signature) => [
      signature,
      keccak256(toBytes(signature)).slice(0, 10),
    ]),
  ),
  merchantRegisteredTopic: keccak256(
    toBytes("MerchantRegistered(address,address,bytes32)"),
  ),
  paymentIntentCreatedTopic: keccak256(
    toBytes(
      "PaymentIntentCreated(bytes32,address,address,address,uint256,uint16,uint64,bytes32)",
    ),
  ),
};

async function installOnchainMockWallet(
  page: Page,
  options: {
    initialRegistered?: boolean;
    rejectFirstTransaction?: boolean;
    initialChainId?: string;
  } = {},
) {
  await page.addInitScript(
    ({
      account,
      config,
      initialRegistered,
      rejectFirstTransaction,
      initialChainId,
    }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const zeroAddress = `0x${"0".repeat(40)}`;
      const zeroHash = `0x${"0".repeat(64)}`;
      const blockHash = `0x${"a".repeat(64)}`;
      const state: {
        registered: boolean;
        rejectTransaction: boolean;
        chainId: string;
        invoice: null | {
          orderId: string;
          amount: string;
          expiresAt: string;
          metadataHash: string;
        };
      } = {
        registered: initialRegistered,
        rejectTransaction: rejectFirstTransaction,
        chainId: initialChainId,
        invoice: null,
      };
      const stripHex = (value: string) => value.replace(/^0x/, "");
      const word = (value: string) => stripHex(value).padStart(64, "0");
      const encodedAddress = (value: string) => `0x${word(value)}`;
      const encodedUint = (value: number) =>
        `0x${BigInt(value).toString(16).padStart(64, "0")}`;
      const receipt = (hash: string, to: string, logs: unknown[]) => ({
        blockHash,
        blockNumber: "0x32a0000",
        contractAddress: null,
        cumulativeGasUsed: "0x30d40",
        effectiveGasPrice: "0x1",
        from: account,
        gasUsed: "0x30d40",
        logs,
        logsBloom: `0x${"0".repeat(512)}`,
        status: "0x1",
        to,
        transactionHash: hash,
        transactionIndex: "0x0",
        type: "0x2",
      });
      const log = (
        address: string,
        transactionHash: string,
        topics: string[],
        data: string,
      ) => ({
        address,
        blockHash,
        blockNumber: "0x32a0000",
        data,
        logIndex: "0x0",
        removed: false,
        topics,
        transactionHash,
        transactionIndex: "0x0",
      });
      const hydrateInvoiceFromStorage = () => {
        if (state.invoice) return;
        try {
          const invoices = JSON.parse(
            window.localStorage.getItem("settlelink.onchain-invoices.v1") ??
              "[]",
          ) as {
            orderId?: string;
            amountUnits?: string;
            expiresAt?: number;
            metadataHash?: string;
          }[];
          const persisted = invoices[0];
          if (
            persisted?.orderId &&
            persisted.amountUnits &&
            persisted.expiresAt &&
            persisted.metadataHash
          ) {
            state.invoice = {
              orderId: persisted.orderId,
              amount: BigInt(persisted.amountUnits)
                .toString(16)
                .padStart(64, "0"),
              expiresAt: BigInt(persisted.expiresAt)
                .toString(16)
                .padStart(64, "0"),
              metadataHash: persisted.metadataHash,
            };
          }
        } catch {
          // Invalid local test state should behave like a missing invoice.
        }
      };
      const rpcResult = (method: string, params: unknown[] = []): unknown => {
        hydrateInvoiceFromStorage();
        if (method === "eth_chainId") return "0x4cef52";
        if (method === "eth_blockNumber") return "0x32a0001";
        if (method === "eth_getCode") return "0x60006000";
        if (method === "eth_estimateGas") return "0x30d40";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_call") {
          const call = params[0] as { data?: string; to?: string };
          const selector = call.data?.slice(0, 10) ?? "";
          const destination = call.to?.toLowerCase();
          if (
            destination === config.registry &&
            selector === config.selectors["merchantOf(address)"]
          ) {
            return state.registered
              ? `0x${word(account)}${word(account)}${stripHex(zeroHash)}${word("1")}${word("64")}`
              : `0x${word(zeroAddress)}${word(zeroAddress)}${stripHex(zeroHash)}${word("0")}${word("0")}`;
          }
          if (destination === config.factory) {
            if (selector === config.selectors["merchantRegistry()"])
              return encodedAddress(config.registry);
            if (selector === config.selectors["usdc()"])
              return encodedAddress(config.usdc);
            if (selector === config.selectors["vaultImplementation()"])
              return encodedAddress(config.vaultImplementation);
            if (
              selector === config.selectors["vaultByOrderId(address,bytes32)"]
            )
              return encodedAddress(state.invoice ? config.vault : zeroAddress);
            if (
              selector ===
              config.selectors["predictPaymentVault(address,bytes32)"]
            )
              return encodedAddress(config.vault);
            if (
              selector ===
              config.selectors[
                "createPaymentIntent(bytes32,uint256,uint64,bytes32)"
              ]
            )
              return encodedAddress(config.vault);
          }
          if (destination === config.registry) return "0x";
          if (destination === config.vault && state.invoice) {
            if (selector === config.selectors["merchant()"])
              return encodedAddress(account);
            if (selector === config.selectors["payoutAddress()"])
              return encodedAddress(account);
            if (selector === config.selectors["orderId()"])
              return state.invoice.orderId;
            if (selector === config.selectors["expectedAmount()"])
              return `0x${state.invoice.amount}`;
            if (selector === config.selectors["currentBalance()"])
              return encodedUint(0);
            if (selector === config.selectors["expiresAt()"])
              return `0x${state.invoice.expiresAt}`;
            if (selector === config.selectors["paymentState()"])
              return encodedUint(0);
            if (
              selector === config.selectors["payer()"] ||
              selector === config.selectors["payerRefundAddress()"]
            )
              return encodedAddress(zeroAddress);
          }
          const detail = `eth_call ${destination} ${selector}`;
          window.localStorage.setItem("mock.lastRpc", detail);
          throw new Error(`Unsupported mock ${detail}`);
        }
        if (method === "eth_getTransactionReceipt") {
          const hash = String(params[0]).toLowerCase();
          if (hash === config.registrationHash) {
            return receipt(config.registrationHash, config.registry, [
              log(
                config.registry,
                config.registrationHash,
                [
                  config.merchantRegisteredTopic,
                  `0x${word(account)}`,
                  `0x${word(account)}`,
                ],
                zeroHash,
              ),
            ]);
          }
          if (hash === config.creationHash && state.invoice) {
            return receipt(config.creationHash, config.factory, [
              log(
                config.factory,
                config.creationHash,
                [
                  config.paymentIntentCreatedTopic,
                  state.invoice.orderId,
                  `0x${word(account)}`,
                  `0x${word(config.vault)}`,
                ],
                `0x${word(account)}${state.invoice.amount}${word("19")}${state.invoice.expiresAt}${stripHex(state.invoice.metadataHash)}`,
              ),
            ]);
          }
          return null;
        }
        window.localStorage.setItem("mock.lastRpc", method);
        throw new Error(`Unsupported mock Arc RPC method: ${method}`);
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const normalizedUrl = url.replace(/\/$/, "");
        const isArcRpc =
          normalizedUrl === config.rpcUrl ||
          new URL(url, window.location.origin).pathname === "/api/arc-rpc";
        if (!isArcRpc) return originalFetch(input, init);
        const requestBody =
          typeof init?.body === "string"
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : null;
        if (!requestBody)
          throw new Error("Mock Arc RPC expected a JSON string request body");
        const parsed = JSON.parse(requestBody) as
          | { id: number; method: string; params?: unknown[] }
          | { id: number; method: string; params?: unknown[] }[];
        const methods = (Array.isArray(parsed) ? parsed : [parsed]).map(
          (request) => request.method,
        );
        const previousMethods = JSON.parse(
          window.localStorage.getItem("mock.rpcMethods") ?? "[]",
        ) as string[];
        window.localStorage.setItem(
          "mock.rpcMethods",
          JSON.stringify([...previousMethods, ...methods]),
        );
        const handle = (request: {
          id: number;
          method: string;
          params?: unknown[];
        }) => ({
          id: request.id,
          jsonrpc: "2.0",
          result: rpcResult(request.method, request.params),
        });
        return new Response(
          JSON.stringify(
            Array.isArray(parsed) ? parsed.map(handle) : handle(parsed),
          ),
          { headers: { "content-type": "application/json" } },
        );
      };
      const ethereum = {
        isMetaMask: true,
        on(event: string, listener: (...args: unknown[]) => void) {
          const current = listeners.get(event) ?? new Set();
          current.add(listener);
          listeners.set(event, current);
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(listener);
        },
        request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_accounts")
            return Promise.resolve(
              window.localStorage.getItem("mock.wallet.authorized") === "yes"
                ? [account]
                : [],
            );
          if (method === "eth_requestAccounts") {
            window.localStorage.setItem("mock.wallet.authorized", "yes");
            queueMicrotask(() => {
              for (const listener of listeners.get("chainChanged") ?? [])
                listener(state.chainId);
            });
            return Promise.resolve([account]);
          }
          if (method === "eth_chainId") return Promise.resolve(state.chainId);
          if (method === "wallet_switchEthereumChain") {
            state.chainId = (params?.[0] as { chainId: string }).chainId;
            window.localStorage.setItem("mock.switchAttempted", state.chainId);
            for (const listener of listeners.get("chainChanged") ?? [])
              listener(state.chainId);
            return Promise.resolve(null);
          }
          if (method === "eth_sendTransaction") {
            window.localStorage.setItem("mock.sendAttempted", "yes");
            if (state.rejectTransaction) {
              state.rejectTransaction = false;
              return Promise.reject(
                Object.assign(new Error("User rejected the request."), {
                  code: 4001,
                }),
              );
            }
            const transaction = params?.[0] as { data: string; to: string };
            if (transaction.to.toLowerCase() === config.registry) {
              state.registered = true;
              if (rejectFirstTransaction) state.rejectTransaction = true;
              return Promise.resolve(config.registrationHash);
            }
            const body = stripHex(transaction.data).slice(8);
            state.invoice = {
              orderId: `0x${body.slice(0, 64)}`,
              amount: body.slice(64, 128),
              expiresAt: body.slice(128, 192),
              metadataHash: `0x${body.slice(192, 256)}`,
            };
            return Promise.resolve(config.creationHash);
          }
          if (method === "wallet_getPermissions") return Promise.resolve([]);
          if (method === "wallet_requestPermissions")
            return Promise.resolve([{ parentCapability: "eth_accounts" }]);
          return Promise.reject(
            new Error(`Unsupported onchain mock wallet method: ${method}`),
          );
        },
      };
      Object.defineProperty(window, "ethereum", {
        configurable: false,
        value: ethereum,
      });
      Object.defineProperty(window, "__settlelinkSetMockChainId", {
        configurable: false,
        value: (chainId: string) => {
          state.chainId = chainId;
        },
      });
    },
    {
      account: merchant,
      config: {
        ...arcMock,
        registrationHash: arcMock.registrationHash.toLowerCase(),
        creationHash: arcMock.creationHash.toLowerCase(),
      },
      rejectFirstTransaction: options.rejectFirstTransaction ?? false,
      initialChainId: options.initialChainId ?? "0x4cef52",
      initialRegistered: options.initialRegistered ?? false,
    },
  );
}

async function installMockWallet(
  page: Page,
  options: { rejectFirstRequest?: boolean } = {},
) {
  await page.addInitScript(
    ({ account, rejectFirstRequest }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let chainId = "0x4cef52";
      let shouldReject = rejectFirstRequest;
      const ethereum = {
        isMetaMask: true,
        on(event: string, listener: (...args: unknown[]) => void) {
          const current = listeners.get(event) ?? new Set();
          current.add(listener);
          listeners.set(event, current);
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(listener);
        },
        request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_accounts")
            return Promise.resolve(
              window.localStorage.getItem("mock.wallet.authorized") === "yes"
                ? [account]
                : [],
            );
          if (method === "eth_requestAccounts") {
            if (shouldReject) {
              shouldReject = false;
              return Promise.reject(
                Object.assign(new Error("User rejected the request."), {
                  code: 4001,
                }),
              );
            }
            window.localStorage.setItem("mock.wallet.authorized", "yes");
            return Promise.resolve([account]);
          }
          if (method === "eth_chainId") return Promise.resolve(chainId);
          if (method === "wallet_switchEthereumChain") {
            chainId = (params?.[0] as { chainId: string }).chainId;
            for (const listener of listeners.get("chainChanged") ?? [])
              listener(chainId);
            return Promise.resolve(null);
          }
          if (["personal_sign", "eth_signTypedData_v4"].includes(method))
            return Promise.resolve(`0x${"1".repeat(130)}`);
          if (method === "wallet_getPermissions") return Promise.resolve([]);
          if (method === "wallet_requestPermissions")
            return Promise.resolve([{ parentCapability: "eth_accounts" }]);
          if (method === "wallet_revokePermissions") {
            window.localStorage.removeItem("mock.wallet.authorized");
            for (const listener of listeners.get("accountsChanged") ?? [])
              listener([]);
            return Promise.resolve(null);
          }
          return Promise.reject(
            new Error(`Unsupported mock wallet method: ${method}`),
          );
        },
      };
      Object.defineProperty(window, "ethereum", {
        configurable: false,
        value: ethereum,
      });
    },
    {
      account: merchant,
      rejectFirstRequest: options.rejectFirstRequest ?? false,
    },
  );
}

test("wallet chooser handles absent providers and preserves keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Connect wallet" }).first();
  await trigger.click();
  await expect(
    page.getByRole("heading", { name: "Choose a wallet" }),
  ).toBeVisible();
  await expect(page.getByText("Install a browser wallet")).toBeVisible();
  await expect(page.getByText("WalletConnect unavailable")).toBeVisible();
  await page.screenshot({
    path: path.join(walletEvidenceDirectory, "wallet-dialog-no-provider.png"),
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("public navigation exposes proof, contracts, and GitHub", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Proof of Build" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contracts" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "GitHub" }).first(),
  ).toHaveAttribute(
    "href",
    "https://github.com/hitmol/Arc-Crosschain-Checkout",
  );
});

test("proof renders verified Arc activity and labels CCTP as pending", async ({
  page,
}) => {
  await page.goto("/proof");
  await expect(
    page.getByRole("heading", { name: "Proof of Build" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "MerchantRegistry", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(
        'a[href="https://testnet.arcscan.app/tx/0xeccbc52892cd6048bff8483cc678518cf328fd7df88fba38bf2dc9eeb29ba8f6"]',
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Full CCTP route")).toBeVisible();
  await expect(page.getByText("Not yet recorded")).toBeVisible();
});

test("rejected injected connection is recoverable", async ({ page }) => {
  await installMockWallet(page, { rejectFirstRequest: true });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Connect wallet" }).first();
  await trigger.click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await expect(
    page.getByRole("alert").getByText("Connection request was rejected."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await expect(
    page.getByRole("button", {
      name: /Wallet 0x1111.*connected on Arc Testnet/,
    }),
  ).toBeVisible();
});

test("responsive public pages and authenticated demo dashboard", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installMockWallet(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Accept USDC across chains",
  );
  await page.keyboard.press("Tab");
  const focusedElement = page.locator(":focus");
  await expect(focusedElement).toBeVisible();
  expect(
    await focusedElement.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe("none");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDirectory, "homepage-1440.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDirectory, "homepage-tablet.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    )
    .toBe("auto");
  await page.screenshot({
    path: path.join(screenshotDirectory, "homepage-390.png"),
    fullPage: true,
  });

  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(screenshotDirectory, "homepage-dark-1440.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/dashboard");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Connect wallet" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose a wallet" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(walletEvidenceDirectory, "wallet-dialog-injected.png"),
  });
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Merchant" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "E2E Merchant" }),
  ).toBeVisible();
  const connectedWallet = page.getByRole("button", {
    name: /Wallet 0x1111.*connected on Arc Testnet/,
  });
  await connectedWallet.click();
  await expect(
    page.getByRole("heading", { name: "Wallet connected" }),
  ).toBeVisible();
  await expect(page.getByText("Arc Testnet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect wallet" }).click();
  await page.reload();
  const reconnect = page
    .getByRole("main")
    .getByRole("button", { name: "Connect wallet" });
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Merchant" }),
  ).toBeVisible();
});

test("creates and recovers a verified onchain invoice", async ({ page }) => {
  test.setTimeout(90_000);
  await installOnchainMockWallet(page, {
    initialRegistered: false,
    rejectFirstTransaction: true,
  });
  const unexpectedApiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://127.0.0.1:4100"))
      unexpectedApiRequests.push(request.url());
  });
  await page.goto("/invoices/new");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Connect wallet" })
    .click();
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await expect(
    page.getByRole("button", { name: "Register as a merchant" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const controls = window as unknown as {
      __settlelinkSetMockChainId: (chainId: string) => void;
    };
    controls.__settlelinkSetMockChainId("0x1");
  });
  await page.getByLabel("Business label (optional)").fill("E2E Merchant");
  await page.getByRole("button", { name: "Register as a merchant" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("mock.switchAttempted")),
    )
    .toBe("0x4cef52");
  await expect(page.getByRole("alert").getByText(/rejected/i)).toBeVisible();
  await page.getByRole("button", { name: "Register as a merchant" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  await page.getByLabel("Order reference").fill("E2E-ARC-1042");
  await page.getByLabel("Amount (USDC)").fill("12.500001");
  await page.getByLabel("Description (optional)").fill("Verified browser flow");
  await page.getByRole("button", { name: "Review transaction" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before opening your wallet" }),
  ).toBeVisible();
  await expect(page.getByText("12.500001 USDC")).toBeVisible();
  await page.getByRole("button", { name: "Create invoice on Arc" }).click();
  await expect(page.getByRole("alert").getByText(/rejected/i)).toBeVisible();
  await page.getByRole("button", { name: "Create invoice on Arc" }).click();
  await expect(page).toHaveURL(/\/invoices\/0x1111.*\/E2E-ARC-1042$/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "Invoice created" }),
  ).toBeVisible();
  await expect(page.getByText("12.500001 USDC")).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Invoice created" }),
  ).toBeVisible();
  const storedInvoices = await page.evaluate(
    () => window.localStorage.getItem("settlelink.onchain-invoices.v1") ?? "[]",
  );
  const localInvoices: unknown = JSON.parse(storedInvoices);
  expect(localInvoices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        orderReference: "E2E-ARC-1042",
        status: "confirmed",
        eventName: "PaymentIntentCreated",
      }),
    ]),
  );
  expect(unexpectedApiRequests).toEqual([]);
});
