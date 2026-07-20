import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://arc:arc@localhost:5432/arc_checkout?schema=api_test",
      DEMO_MODE: "true",
    },
  },
});
