import { expect, test } from "@playwright/test";

const merchant = "0x1111111111111111111111111111111111111111";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ account }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let chainId = "0x4cef42";
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
          if (["eth_accounts", "eth_requestAccounts"].includes(method))
            return Promise.resolve([account]);
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
    { account: merchant },
  );
});

test("merchant to mocked CCTP settlement, dashboard and receipt", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Connect wallet" })
    .click();
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
  await page
    .getByRole("button", { name: "Run local state-machine demo" })
    .click();
  await expect(page.getByText("Merchant paid")).toHaveClass(/done/, {
    timeout: 20_000,
  });

  await page.goto("/dashboard");
  await expect(page.getByText("12.50 USDC").first()).toBeVisible();
  await expect(page.getByText("SETTLED").first()).toBeVisible();
  await page.getByRole("link", { name: "E2E-ORDER-1", exact: true }).click();
  await expect(page).toHaveURL(/\/receipts\/e2e-order$/, {
    timeout: 20_000,
  });
  await expect(page.getByText("VERIFIED PAYMENT RECEIPT")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Circle CCTP V2")).toBeVisible();
  await expect(page.getByText("12.47 USDC")).toBeVisible();
});
