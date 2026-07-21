import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

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

async function installMockWallet(
  page: Page,
  options: { rejectFirstRequest?: boolean } = {},
) {
  await page.addInitScript(
    ({ account, rejectFirstRequest }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let chainId = "0x4cef42";
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
    page.locator(
      'a[href="https://testnet.arcscan.app/tx/0xeccbc52892cd6048bff8483cc678518cf328fd7df88fba38bf2dc9eeb29ba8f6"]',
    ),
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

test("merchant to mocked CCTP settlement, dashboard and receipt", async ({
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

  await page.goto("/invoices/new");
  await page.getByLabel("Order reference").fill("E2E-ORDER-1");
  await page.getByLabel("Amount (USDC)").fill("12.50");
  await page.getByRole("button", { name: "Create local demo invoice" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment link is ready." }),
  ).toBeVisible();
  await page.getByRole("link", { name: /pay\/e2e-order/ }).click();

  await expect(page.getByText("Playwright checkout")).toBeVisible();
  await page.getByRole("button", { name: "Review fees" }).click();
  await expect(page.getByText("12.51 USDC")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(screenshotDirectory, "checkout-1440.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run local state-machine demo" })
    .click();
  await expect(page.getByText("Merchant paid")).toHaveClass(/done/, {
    timeout: 20_000,
  });

  await page.goto("/dashboard");
  await expect(page.getByText("12.50 USDC").first()).toBeVisible();
  await expect(page.getByText("SETTLED").first()).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDirectory, "dashboard-1440.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "E2E-ORDER-1", exact: true }).click();
  await expect(page).toHaveURL(/\/receipts\/e2e-order$/, {
    timeout: 20_000,
  });
  await expect(page.getByText("SETTLELINK PAYMENT RECEIPT")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Circle CCTP V2")).toBeVisible();
  await expect(page.getByText("12.47 USDC")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDirectory, "receipt-1440.png"),
    fullPage: true,
  });
});
