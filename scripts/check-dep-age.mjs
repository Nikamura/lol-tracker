#!/usr/bin/env node
// Fails if any package in pnpm-lock.yaml was published less than MIN_DEP_AGE_HOURS ago (default 48).
// Defense in depth against supply-chain attacks: malicious packages are usually detected and yanked
// within a day or two of publish, so refusing to install anything younger than that buys us a
// community vetting window for free.
//
// Knobs:
//   MIN_DEP_AGE_HOURS=48        minimum age in hours (set to 0 to bypass locally)
//   NPM_REGISTRY=https://...    override registry (defaults to npmjs.org)
//
// Runs on plain Node 22 — no dependencies, no transpile step, so it can be invoked before
// `pnpm install` if you ever want to gate the install itself.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_AGE_HOURS = Number(process.env.MIN_DEP_AGE_HOURS ?? "48");
const REGISTRY = (process.env.NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "");
const CONCURRENCY = 10;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockfilePath = resolve(repoRoot, "pnpm-lock.yaml");

function parsePackages(text) {
  const lines = text.split("\n");
  const start = lines.indexOf("packages:");
  if (start < 0) throw new Error(`'packages:' section not found in ${lockfilePath}`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Matches lines like:
  //   '@hono/node-server@2.0.2(hono@4.12.19)':
  //   '@colors/colors@1.5.0':
  //   better-sqlite3@11.10.0:
  const re = /^ {2}'?(@?[^@'(\s][^@'(]*)@([^@'(\s]+)(?:\([^)]*\))?'?:\s*$/;
  const seen = new Map();
  for (let i = start + 1; i < end; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const [, name, version] = m;
    seen.set(`${name}@${version}`, { name, version });
  }
  return [...seen.values()];
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr;
}

function registryUrl(name) {
  // Encode the path but keep the literal '@' and '/' that scoped names use.
  return `${REGISTRY}/${name.replace(/\//g, "%2F")}`;
}

async function mapParallel(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const pkgs = parsePackages(readFileSync(lockfilePath, "utf8"));
  if (pkgs.length === 0) {
    console.error("No packages parsed from pnpm-lock.yaml — lockfile format may have changed.");
    process.exit(2);
  }

  const byName = new Map();
  for (const p of pkgs) {
    if (!byName.has(p.name)) byName.set(p.name, new Set());
    byName.get(p.name).add(p.version);
  }
  const names = [...byName.keys()];

  console.log(
    `Checking ${pkgs.length} pkg@version entries (${names.length} unique names) against ${MIN_AGE_HOURS}h minimum age via ${REGISTRY}…`,
  );

  if (MIN_AGE_HOURS <= 0) {
    console.log("MIN_DEP_AGE_HOURS=0 — skipping (no minimum age enforced).");
    return;
  }

  const cutoff = Date.now() - MIN_AGE_HOURS * 3_600_000;
  const violations = [];
  const unverifiable = [];

  await mapParallel(names, CONCURRENCY, async (name) => {
    let meta;
    try {
      meta = await fetchWithRetry(registryUrl(name));
    } catch (e) {
      for (const version of byName.get(name)) {
        unverifiable.push({ name, version, reason: `registry error: ${e.message}` });
      }
      return;
    }
    if (meta === null || !meta?.time) {
      for (const version of byName.get(name)) {
        unverifiable.push({ name, version, reason: meta === null ? "not found on registry" : "missing 'time' map" });
      }
      return;
    }
    for (const version of byName.get(name)) {
      const ts = meta.time[version];
      if (!ts) {
        unverifiable.push({ name, version, reason: "version missing from registry 'time' map" });
        continue;
      }
      const publishedAt = Date.parse(ts);
      if (Number.isNaN(publishedAt)) {
        unverifiable.push({ name, version, reason: `unparseable timestamp: ${ts}` });
        continue;
      }
      if (publishedAt > cutoff) {
        violations.push({ name, version, publishedAt });
      }
    }
  });

  if (violations.length) {
    violations.sort((a, b) => b.publishedAt - a.publishedAt);
    console.error(
      `\nDependency age policy violated — ${violations.length} package(s) younger than ${MIN_AGE_HOURS}h:`,
    );
    for (const v of violations) {
      const ageH = ((Date.now() - v.publishedAt) / 3_600_000).toFixed(1);
      console.error(`  - ${v.name}@${v.version}  (published ${ageH}h ago — ${new Date(v.publishedAt).toISOString()})`);
    }
    console.error(
      `\nWait until each is older than ${MIN_AGE_HOURS}h, pin to an older version, or update the lockfile to a resolution that satisfies the policy.`,
    );
  }

  if (unverifiable.length) {
    console.error(
      `\nCould not verify publish time for ${unverifiable.length} entries (treated as a failure — we can't enforce the policy without a timestamp):`,
    );
    for (const u of unverifiable) {
      console.error(`  - ${u.name}@${u.version}: ${u.reason}`);
    }
  }

  if (violations.length || unverifiable.length) {
    process.exit(1);
  }

  console.log(`OK — all ${pkgs.length} pkg@version entries are at least ${MIN_AGE_HOURS}h old.`);
}

main().catch((e) => {
  console.error("check-dep-age crashed:", e);
  process.exit(2);
});
