import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://arc:arc@localhost:5432/arc_checkout_test?schema=public",
      DEMO_MODE: "true",
    },
  },
});
