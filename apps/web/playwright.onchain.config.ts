import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "checkout.spec.ts",
  fullyParallel: false,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200/invoices/new",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
