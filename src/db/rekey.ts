import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Match, MatchTimeline } from "../riot/types.js";
import type { DB } from "./connect.js";
import {
  ingestState,
  matchParticipants,
  matchTimelines,
  matches,
  meta,
  playerMastery,
  playerRankSnapshots,
  players,
} from "./schema.js";

export const KEY_FINGERPRINT_META = "riot_key_fingerprint";

export function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export function getMeta(db: DB, key: string): string | undefined {
  return db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

export interface RekeyMapping {
  oldPuuid: string;
  newPuuid: string;
}

/**
 * Move a player's PUUID across every table that keys off it. SQLite's FK
 * constraints on `players.puuid` are declared `ON UPDATE no action`, so we
 * defer FK checks to commit time and update all rows inside a single
 * transaction — at commit, every child row already points to the new PUUID.
 */
export function rekeyPlayerPuuid(db: DB, oldPuuid: string, newPuuid: string): void {
  if (oldPuuid === newPuuid) return;
  db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = 1`);
    tx.update(matchParticipants)
      .set({ puuid: newPuuid })
      .where(eq(matchParticipants.puuid, oldPuuid))
      .run();
    tx.update(playerRankSnapshots)
      .set({ puuid: newPuuid })
      .where(eq(playerRankSnapshots.puuid, oldPuuid))
      .run();
    tx.update(playerMastery)
      .set({ puuid: newPuuid })
      .where(eq(playerMastery.puuid, oldPuuid))
      .run();
    tx.update(ingestState)
      .set({ puuid: newPuuid })
      .where(eq(ingestState.puuid, oldPuuid))
      .run();
    tx.update(players).set({ puuid: newPuuid }).where(eq(players.puuid, oldPuuid)).run();
  });
}

function deepReplaceStrings<T>(value: T, mapping: Map<string, string>): T {
  if (typeof value === "string") {
    return (mapping.get(value) ?? value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepReplaceStrings(v, mapping)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepReplaceStrings(v, mapping);
    }
    return out as T;
  }
  return value;
}

export interface RewriteRawJsonResult {
  matchesUpdated: number;
  timelinesUpdated: number;
}

/**
 * Rewrite PUUIDs embedded in `matches.raw_json` and `match_timelines.raw_json`.
 * The denormalised columns (`match_participants.puuid`) are already fixed by
 * `rekeyPlayerPuuid`; this is the optional eager pass for callers that still
 * mine the raw JSON.
 */
export function rewriteRawJsonPuuids(
  db: DB,
  mapping: Map<string, string>,
): RewriteRawJsonResult {
  if (mapping.size === 0) return { matchesUpdated: 0, timelinesUpdated: 0 };

  let matchesUpdated = 0;
  let timelinesUpdated = 0;

  db.transaction((tx) => {
    const matchRows = tx
      .select({ matchId: matches.matchId, rawJson: matches.rawJson })
      .from(matches)
      .all();
    for (const row of matchRows) {
      const next = rewriteMatchJson(row.rawJson, mapping);
      if (next === row.rawJson) continue;
      tx.update(matches)
        .set({ rawJson: next })
        .where(eq(matches.matchId, row.matchId))
        .run();
      matchesUpdated++;
    }

    const tlRows = tx
      .select({ matchId: matchTimelines.matchId, rawJson: matchTimelines.rawJson })
      .from(matchTimelines)
      .all();
    for (const row of tlRows) {
      const next = rewriteTimelineJson(row.rawJson, mapping);
      if (next === row.rawJson) continue;
      tx.update(matchTimelines)
        .set({ rawJson: next })
        .where(eq(matchTimelines.matchId, row.matchId))
        .run();
      timelinesUpdated++;
    }
  });

  return { matchesUpdated, timelinesUpdated };
}

function rewriteMatchJson(raw: Match, mapping: Map<string, string>): Match {
  if (!hasAnyPuuid(raw, mapping)) return raw;
  return deepReplaceStrings(raw, mapping);
}

function rewriteTimelineJson(raw: MatchTimeline, mapping: Map<string, string>): MatchTimeline {
  if (!hasAnyPuuid(raw, mapping)) return raw;
  return deepReplaceStrings(raw, mapping);
}

function hasAnyPuuid(
  raw: Match | MatchTimeline,
  mapping: Map<string, string>,
): boolean {
  const md = raw.metadata;
  if (md.participants.some((p) => mapping.has(p))) return true;
  const info = raw.info as { participants?: ReadonlyArray<{ puuid?: string }> };
  if (info.participants?.some((p) => p.puuid !== undefined && mapping.has(p.puuid))) {
    return true;
  }
  return false;
}
