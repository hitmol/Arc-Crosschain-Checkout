import { describe, expect, it } from "vitest";
import { chainLogKey, decodeOrderId, nextBlockRange } from "./arc-indexer.js";

describe("Arc event indexer", () => {
  it("resumes on the block after the persisted cursor", () => {
    expect(
      nextBlockRange({
        cursorBlock: 1_050n,
        deploymentBlock: 1_000n,
        headBlock: 1_200n,
        pageSize: 100n,
      }),
    ).toEqual({ fromBlock: 1_051n, toBlock: 1_150n });
  });

  it("paginates the initial range and caps it at the finalized head", () => {
    expect(
      nextBlockRange({
        cursorBlock: null,
        deploymentBlock: 1_000n,
        headBlock: 1_040n,
        pageSize: 100n,
      }),
    ).toEqual({ fromBlock: 1_000n, toBlock: 1_040n });
  });

  it("does not re-scan when the cursor already reached the head", () => {
    expect(
      nextBlockRange({
        cursorBlock: 1_040n,
        deploymentBlock: 1_000n,
        headBlock: 1_040n,
        pageSize: 100n,
      }),
    ).toBeNull();
  });

  it("builds a stable deduplication key", () => {
    const first = chainLogKey({
      chainId: 5_042_002,
      transactionHash: `0x${"AB".repeat(32)}`,
      logIndex: 7,
    });
    const replay = chainLogKey({
      chainId: 5_042_002,
      transactionHash: `0x${"ab".repeat(32)}`,
      logIndex: 7,
    });
    expect(first).toBe(replay);
  });

  it("decodes UTF-8 order IDs from bytes32 event data", () => {
    expect(
      decodeOrderId(
        "0x4f524445522d3130343200000000000000000000000000000000000000000000",
      ),
    ).toBe("ORDER-1042");
    expect(
      decodeOrderId(
        "0x000000000000000000000000000000000000000000004f524445522d31303432",
      ),
    ).toBe("ORDER-1042");
  });
});
