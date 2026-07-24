import { createApp } from "@arc-checkout/api";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
  maxDuration: 60,
};

export default createApp();
