import { expect, test } from "@playwright/test";

test("production CSP permits hydration and keeps a per-request nonce", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("script-src 'self' 'nonce-");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");

  // Next.js can append trusted descendant scripts after hydration. Under
  // strict-dynamic those descendants do not need their own nonce, so verify
  // the server-rendered nonce-bearing scripts rather than every live DOM tag.
  const scripts = page.locator("script[nonce]");
  expect(await scripts.count()).toBeGreaterThan(0);
  const nonces = await scripts.evaluateAll((elements) =>
    elements.map((element) => element.nonce),
  );
  expect(new Set(nonces).size).toBe(1);

  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Choose a wallet" }),
  ).toBeVisible();

  expect(browserErrors).toEqual([]);
});
