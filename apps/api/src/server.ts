import { createApp } from "./app.js";
import { config } from "./config.js";

const server = createApp().listen(config.API_PORT, "0.0.0.0", () => {
  console.log(
    `Arc Checkout API listening on http://localhost:${config.API_PORT}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
