export const DEFAULT_PRODUCT_NAME = "SettleLink";

export type BrandConfig = {
  productName: string;
  shortDescription: string;
  infrastructureAttribution: string;
  protocolAttribution: string;
  legalDisclaimer: string;
};

function safeProductName(value?: string): string {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 40) return DEFAULT_PRODUCT_NAME;
  return /^[A-Za-z0-9][A-Za-z0-9 .&'-]*$/.test(candidate)
    ? candidate
    : DEFAULT_PRODUCT_NAME;
}

export function createBrandConfig(productName?: string): BrandConfig {
  return {
    productName: safeProductName(productName),
    shortDescription:
      "Crosschain USDC checkout with unified settlement on Arc.",
    infrastructureAttribution: "Built on Arc",
    protocolAttribution: "Uses Circle CCTP",
    legalDisclaimer:
      "Independent testnet software. Not affiliated with or endorsed by Circle or Arc.",
  };
}
