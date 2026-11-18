// `npm audit --omit=dev --audit-level=high` for the app in the current directory, minus the advisories
// excepted in .github/npm-audit-exceptions.json. Each exception names the last vulnerable version of
// its package: once the registry has a newer one, the check fails until the lockfile takes the fix
// and the exception comes out. See docs/ops/security-updates.md.
//
// Usage (from api/ or app-client/): node ../.github/scripts/npm-audit.mjs <app>

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const app = process.argv[2];
if (!app) {
  console.error("usage: node ../.github/scripts/npm-audit.mjs <app>");
  process.exit(2);
}

const BLOCKING = new Set(["high", "critical"]);
const exceptions = JSON.parse(readFileSync(new URL("../npm-audit-exceptions.json", import.meta.url), "utf8")).filter(
  (entry) => entry.app === app
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  try {
    return execFileSync(npm, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  } catch (error) {
    // npm audit exits 1 when it finds anything; the report is still on stdout.
    if (typeof error.stdout === "string" && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

/** 1, 0 or -1: plain x.y.z comparison (prerelease tags ignored). */
function compareVersions(a, b) {
  const pa = String(a).split("-")[0].split(".").map(Number);
  const pb = String(b).split("-")[0].split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

const report = JSON.parse(run(["audit", "--omit=dev", "--json"]));
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary || JSON.stringify(report.error)}`);
  process.exit(1);
}

// Advisories, once each: a package's `via` lists advisory objects (and names of the vulnerable
// packages it depends on, which carry their own advisories).
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const via of vulnerability.via || []) {
    if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
    const id = String(via.url || via.source).split("/").pop();
    advisories.set(id, { id, name: via.name, title: via.title, severity: via.severity, range: via.range, url: via.url });
  }
}

let failed = false;
const excepted = new Set(exceptions.map((entry) => entry.advisory));

for (const advisory of advisories.values()) {
  if (excepted.has(advisory.id)) {
    console.log(`excepted: ${advisory.name} ${advisory.range} (${advisory.severity}) ${advisory.url}`);
    continue;
  }
  failed = true;
  console.log(`::error::${advisory.name} ${advisory.range} (${advisory.severity}): ${advisory.title} ${advisory.url}`);
}

for (const entry of exceptions) {
  const latest = run(["view", entry.package, "version"]).trim();
  if (compareVersions(latest, entry.lastVulnerable) > 0) {
    failed = true;
    console.log(
      `::error::${entry.package} ${latest} is out (${entry.advisory} covers up to ${entry.lastVulnerable}): update the lockfile to it and remove the exception from .github/npm-audit-exceptions.json.`
    );
  } else if (!advisories.has(entry.advisory)) {
    console.log(`::warning::${entry.advisory} is no longer reported for ${app}: remove its exception from .github/npm-audit-exceptions.json.`);
  }
}

if (failed) process.exit(1);
console.log(`npm audit (${app}): no high or critical advisories outside the exceptions.`);
