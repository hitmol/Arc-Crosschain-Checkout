# Sample attribution

The implementation was written for Arc Crosschain Checkout. Official Arc and Circle documentation, Circle Skills, and CCTP quickstarts were used as protocol references. No code was copied from the archived `circlefin/cctp-sample-app`; that repository is explicitly deprecated and was reviewed only to avoid adopting obsolete patterns.

| Reference sample capability | Arc Crosschain Checkout capability |
| --------------------------- | ---------------------------------- |
| Basic USDC transfer         | Payment for a specific invoice     |
| Single recipient transfer   | Unique per-invoice Arc vault       |
| Transfer status             | Merchant payment lifecycle         |
| No merchant tools           | Links, QR codes and dashboard      |
| No settlement protocol      | Original Arc settlement contracts  |
| No webhook system           | Signed merchant notifications      |
| No payment SDK              | Reusable checkout SDK              |

Dependencies retain their own licenses. OpenZeppelin and forge-std are used as declared package dependencies. Circle's shared USDC and CCTP contracts are neither copied nor claimed as project-owned.
