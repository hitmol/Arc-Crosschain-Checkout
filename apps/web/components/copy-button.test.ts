import { describe, expect, it } from "vitest";
import { copyButtonAccessibleLabel } from "./copy-button";

describe("CopyButton accessible name", () => {
  it("generates a single Copy prefix", () => {
    expect(copyButtonAccessibleLabel("Deployer address")).toBe(
      "Copy deployer address",
    );
    expect(copyButtonAccessibleLabel("Copy treasury address")).toBe(
      "Copy treasury address",
    );
  });
});
