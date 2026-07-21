# SettleLink brand and Arc attribution compliance

Last reviewed: 2026-07-21

## Status

**Provisional compliance, not a claim of approval.** The repository follows the publicly available Arc partner guidance and Circle Brand Use Policy, but the project has not received a brand review, trademark licence, partnership confirmation, or co-marketing approval from Circle. If Circle or Arc provides project-specific direction, that direction takes precedence and this record must be updated.

## Brand hierarchy

- **Product and operator:** SettleLink.
- **Settlement infrastructure:** Arc.
- **Crosschain transfer infrastructure:** Circle CCTP.
- **Approved public phrasing in this repository:** “Built on Arc”, “settlement on Arc”, “uses Circle CCTP”, and factual network labels such as “Arc Testnet”.
- **Disallowed positioning:** an Arc product, official Arc checkout, Arc partner, endorsed by Arc/Circle, or any wording that implies Circle operates SettleLink.

SettleLink uses an original connected-route symbol, indigo/coral product palette, and its own typography and layout. The symbol does not contain the Arc name, arch, logo, or Circle marks. The product favicon and social card use only the SettleLink identity.

## Arc mark usage decision

No Arc logo file is shipped or rendered. Text-only attribution is used instead. This avoids minimum-size, clear-space, latest-asset, and approval ambiguity while still explaining the technical relationship. If an official Arc logo is added later, use only the current asset from Circle’s Brand Kit, keep at least the required clear space, meet the documented 50 px digital minimum height, and obtain any required approval before publication.

## Surface audit

| Surface                         | Product leads                       | Arc role is factual                    | No endorsement implication | Status                  |
| ------------------------------- | ----------------------------------- | -------------------------------------- | -------------------------- | ----------------------- |
| Header, footer, favicon         | Yes                                 | Text-only secondary attribution        | Yes                        | Implemented             |
| Homepage and route diagram      | Yes                                 | Destination settlement layer           | Yes                        | Implemented             |
| Checkout                        | Merchant + SettleLink operator line | Network and final settlement           | Yes                        | Implemented             |
| Merchant dashboard              | Merchant + SettleLink shell         | Verification/settlement context        | Yes                        | Implemented             |
| Receipt and JSON download       | SettleLink receipt                  | CCTP route and Arc settlement evidence | Yes                        | Implemented             |
| Metadata, manifest, social card | SettleLink                          | Small text attribution                 | Yes                        | Implemented             |
| Developer docs and README       | SettleLink                          | Architecture and network labels        | Yes                        | Implemented             |
| Legacy package/env identifiers  | Documented compatibility layer      | Technical namespace only               | Yes                        | Accepted migration debt |

## Required pre-publication checks

1. Confirm `NEXT_PUBLIC_PRODUCT_NAME=SettleLink` in the deployment environment.
2. Review any new marketing copy for “official”, “partner”, “endorsed”, or “Arc [product]” constructions.
3. Do not add Arc/Circle logo assets without checking the latest Brand Kit and approval requirements.
4. Re-run repository text search and screenshot review at 390 px, tablet, and 1440 px widths.
5. Keep the independent-product disclaimer in the public footer and README.

## Reproducible visual evidence

The Playwright checkout flow writes current screenshots to `evidence/brand/`:

- `homepage-1440.png`, `homepage-tablet.png`, and `homepage-390.png`;
- `homepage-dark-1440.png`;
- `checkout-1440.png`, `dashboard-1440.png`, and `receipt-1440.png`.

The same test asserts no horizontal overflow at 1440, 768, and 390 px,
verifies the keyboard focus indicator, checks reduced-motion behavior, and then
completes the mocked CCTP lifecycle through the final receipt.

## Sources

- [Arc Brand Guidelines and Partner Toolkit announcement](https://community.arc.io/public/blogs/arc-brand-guidelines-and-partner-toolkit-is-live-2026-07-16)
- [Arc Brand Guidelines and Partner Toolkit](https://www.arc.io/brand-guidelines-and-partner-toolkit)
- [Circle Brand Use Policy](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CircleBrandUsePolicy.pdf)
- [Circle pressroom and official Brand Kit downloads](https://www.circle.com/en/pressroom)

## Trademark notice

SettleLink is an independent project. It is not affiliated with or endorsed by Circle or Arc. Circle, Arc, USDC, CCTP, and related marks belong to their respective owners.
