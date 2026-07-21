import { createBrandConfig } from "@arc-checkout/shared";

export const brand = createBrandConfig(
  process.env.NEXT_PUBLIC_PRODUCT_NAME,
);
