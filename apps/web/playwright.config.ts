import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/mock-api.mjs",
      port: 4_100,
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec next dev --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DEMO_MODE: "true",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4100",
      },
    },
  ],
});
