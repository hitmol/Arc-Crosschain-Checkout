import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-csp.spec.ts",
  reporter: "list",
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
