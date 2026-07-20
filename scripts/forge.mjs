import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const bundledForge = path.join(root, ".tools", "foundry", "forge.exe");
const local = spawnSync(
  process.platform === "win32" && existsSync(bundledForge)
    ? bundledForge
    : "forge",
  args,
  {
    cwd: path.join(root, "packages", "contracts"),
    stdio: "inherit",
    shell: false,
  },
);

if (!local.error) process.exit(local.status ?? 1);

const volume = `${root.replaceAll("\\", "/")}:/workspace`;
const docker = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    volume,
    "-w",
    "/workspace/packages/contracts",
    "ghcr.io/foundry-rs/foundry:stable",
    "forge",
    ...args,
  ],
  { stdio: "inherit", shell: false },
);
if (docker.error) throw docker.error;
process.exit(docker.status ?? 1);
