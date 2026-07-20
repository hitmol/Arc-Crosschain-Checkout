import { chainConfig } from "./index.js";

const officialPages = [
  "https://docs.arc.io/arc/references/connect-to-arc",
  "https://docs.arc.io/arc/references/contract-addresses",
  "https://developers.circle.com/cctp/concepts/supported-chains-and-domains",
  "https://developers.circle.com/cctp/references/contract-addresses",
  "https://developers.circle.com/stablecoins/usdc-contract-addresses",
];

console.log("Manual verification checklist (official sources only):");
for (const page of officialPages) console.log(`- ${page}`);
console.log("\nConfigured testnets:");
for (const chain of chainConfig) {
  console.log(
    `- ${chain.name}: chain ${chain.chainId}, CCTP domain ${chain.cctpDomain}, USDC ${chain.usdc}`,
  );
}
console.log(
  "\nThis script intentionally does not scrape documentation HTML in CI; confirm changes before updating signed addresses.",
);
