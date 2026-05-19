import pc from "picocolors";
import type { DB } from "../db/connect.js";
import { listPlayers } from "../db/queries.js";
import {
  KEY_FINGERPRINT_META,
  getMeta,
  keyFingerprint,
  setMeta,
} from "../db/rekey.js";

/**
 * Compare the current API key's fingerprint to the one stored in `meta`.
 *
 * - First run / no players yet → silently store the fingerprint, return ok.
 * - Stored fingerprint matches → return ok.
 * - Stored fingerprint differs → return mismatch (caller decides whether to
 *   refuse: poll/serve do, since their PUUID-keyed endpoints will 400-storm).
 */
export type KeyCheckResult =
  | { kind: "ok" }
  | { kind: "mismatch"; oldFingerprint: string; newFingerprint: string };

export function checkKeyFingerprint(db: DB, apiKey: string): KeyCheckResult {
  const newFp = keyFingerprint(apiKey);
  const oldFp = getMeta(db, KEY_FINGERPRINT_META);
  if (oldFp === newFp) return { kind: "ok" };
  if (!oldFp) {
    // First run or fresh DB. Adopt the current key as the baseline only if
    // there are no players yet — otherwise the existing PUUIDs were issued by
    // some unknown prior key and we shouldn't silently bless them.
    if (listPlayers(db).length === 0) {
      setMeta(db, KEY_FINGERPRINT_META, newFp);
      return { kind: "ok" };
    }
    return { kind: "mismatch", oldFingerprint: "(unknown)", newFingerprint: newFp };
  }
  return { kind: "mismatch", oldFingerprint: oldFp, newFingerprint: newFp };
}

export function refuseOnKeyMismatch(db: DB, apiKey: string, context: string): void {
  const r = checkKeyFingerprint(db, apiKey);
  if (r.kind === "ok") return;
  console.error(
    pc.red(
      `✗ Riot API key fingerprint changed (${r.oldFingerprint} → ${r.newFingerprint}).`,
    ),
  );
  console.error(
    pc.yellow(
      `  ${context} would 400-storm on stale PUUIDs. Run 'lol-tracker rekey' first.`,
    ),
  );
  process.exit(1);
}
