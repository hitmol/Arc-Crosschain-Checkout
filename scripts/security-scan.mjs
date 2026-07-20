import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".tools",
  ".turbo",
  "broadcast",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const ignoredFiles = new Set([
  ".env",
  ".env.example",
  "pnpm-lock.yaml",
  "security-scan.mjs",
  "tsconfig.tsbuildinfo",
]);
const patterns = [
  /PRIVATE_KEY\s*=\s*0x[a-fA-F0-9]{64}/g,
  /(?:API_KEY|SECRET|PASSWORD)\s*=\s*[^\s#${][^\s#]*/g,
  /dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(/g,
  /Access-Control-Allow-Origin[^\n]*\*/g,
];
const findings = [];

function scanDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(absolute);
      continue;
    }
    if (!entry.isFile() || ignoredFiles.has(entry.name)) continue;
    if (statSync(absolute).size > 1_000_000) continue;
    const contents = readFileSync(absolute, "utf8");
    if (contents.includes("\0")) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of contents.matchAll(pattern)) {
        const line = contents.slice(0, match.index).split("\n").length;
        findings.push(
          `${path.relative(root, absolute)}:${line}: ${match[0].slice(0, 100)}`,
        );
      }
    }
  }
}

scanDirectory(root);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Security pattern scan passed.");
}
