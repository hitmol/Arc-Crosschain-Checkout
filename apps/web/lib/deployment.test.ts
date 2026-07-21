import { describe, expect, it } from "vitest";
import rawDeployment from "../../../deployments/arc-testnet.json";
import { API_URL, PUBLIC_READ_ONLY_MODE } from "./api";
import {
  ARC_EXPLORER,
  arcDeployment,
  interactionEvidence,
  parseDeploymentRecord,
  projectContracts,
} from "./deployment";

describe("public proof data", () => {
  it("parses the verified deployment file as its source of truth", () => {
    expect(arcDeployment).toEqual(parseDeploymentRecord(rawDeployment));
    expect(projectContracts.map((contract) => contract.address)).toEqual(
      Object.values(rawDeployment.contracts),
    );
  });

  it("uses Arc Testnet explorer links", () => {
    expect(projectContracts).toHaveLength(4);
    for (const contract of projectContracts) {
      expect(contract.addressUrl).toBe(`${ARC_EXPLORER}/address/${contract.address}`);
      expect(contract.transactionUrl).toBe(
        `${ARC_EXPLORER}/tx/${contract.deploymentTransaction}`,
      );
    }
  });

  it("labels missing interaction evidence without inventing hashes", () => {
    const missing = interactionEvidence.filter((item) => !item.evidence);
    expect(missing.length).toBeGreaterThan(0);
    expect(JSON.stringify(missing)).not.toMatch(/0x0{64}/i);
  });

  it("rejects fake placeholder deployment hashes", () => {
    expect(() =>
      parseDeploymentRecord({
        ...rawDeployment,
        deploymentTransactions: {
          ...rawDeployment.deploymentTransactions,
          CheckoutFactory: `0x${"0".repeat(64)}`,
        },
      }),
    ).toThrow(/Placeholder hash rejected/);
  });

  it("does not fall back to a localhost API when unconfigured", () => {
    expect(API_URL).toBeNull();
    expect(PUBLIC_READ_ONLY_MODE).toBe(true);
  });
});
