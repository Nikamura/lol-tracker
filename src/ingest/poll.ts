import pc from "picocolors";
import type { Platform, Region } from "../config.js";
import type { DB } from "../db/connect.js";
import {
  getIngestState,
  insertMatch,
  insertMatchTimeline,
  insertRankSnapshot,
  listPlayers,
  matchExists,
  setIngestMasteryAt,
  setIngestMatchCursor,
  setIngestRankAt,
  timelineExists,
  upsertMastery,
  type Player,
} from "../db/queries.js";
import { RiotApiError, type RiotClient } from "../riot/client.js";
import {
  getChampionMasteriesByPuuid,
  getLeagueEntriesByPuuid,
  getMatch,
  getMatchIdsByPuuid,
  getMatchTimeline,
} from "../riot/endpoints.js";

export interface PollOptions {
  defaultBackfillDays: number;
  pageSize: number;
  fetchTimelines: boolean;
  fetchRank: boolean;
  fetchMastery: boolean;
  masteryStaleMs: number;
}

export interface PollResult {
  player: Player;
  newMatches: number;
  skipped: number;
  timelines: number;
  rankSnapshot: boolean;
  masteryRefreshed: boolean;
  error?: string;
}

export async function pollAll(
  db: DB,
  client: RiotClient,
  opts: PollOptions,
): Promise<PollResult[]> {
  const players = listPlayers(db);
  const results: PollResult[] = [];
  for (const player of players) {
    try {
      results.push(await pollPlayer(db, client, player, opts));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(pc.red(`✗ ${player.displayName ?? player.gameName}: ${msg}`));
      results.push({
        player,
        newMatches: 0,
        skipped: 0,
        timelines: 0,
        rankSnapshot: false,
        masteryRefreshed: false,
        error: msg,
      });
    }
  }
  return results;
}

export async function pollPlayer(
  db: DB,
  client: RiotClient,
  player: Player,
  opts: PollOptions,
): Promise<PollResult> {
  const state = getIngestState(db, player.puuid);
  const nowMs = Date.now();
  const startTimeSec = Math.floor(
    (state?.lastMatchStart ?? nowMs - opts.defaultBackfillDays * 86_400_000) / 1000,
  );

  const label = player.displayName ?? `${player.gameName}#${player.tagLine}`;
  const region = player.region as Region;
  const platform = player.platform as Platform;
  let newMatches = 0;
  let skipped = 0;
  let timelines = 0;
  let highestStart = state?.lastMatchStart ?? 0;
  let start = 0;

  while (true) {
    const ids = await getMatchIdsByPuuid(client, region, player.puuid, {
      startTime: startTimeSec,
      start,
      count: opts.pageSize,
    });
    if (ids.length === 0) break;

    for (const id of ids) {
      const haveMatch = matchExists(db, id);
      if (!haveMatch) {
        try {
          const match = await getMatch(client, region, id);
          insertMatch(db, match);
          newMatches++;
          if (match.info.gameStartTimestamp > highestStart) {
            highestStart = match.info.gameStartTimestamp;
          }
        } catch (e) {
          if (e instanceof RiotApiError && e.status === 404) {
            console.error(pc.yellow(`  ${id}: 404 — skipping`));
            continue;
          }
          throw e;
        }
      } else {
        skipped++;
      }

      if (opts.fetchTimelines && !timelineExists(db, id)) {
        try {
          const tl = await getMatchTimeline(client, region, id);
          insertMatchTimeline(db, id, tl);
          timelines++;
        } catch (e) {
          if (e instanceof RiotApiError && e.status === 404) {
            console.error(pc.yellow(`  ${id} timeline: 404 — skipping`));
          } else {
            throw e;
          }
        }
      }
    }
    if (ids.length < opts.pageSize) break;
    start += opts.pageSize;
  }

  setIngestMatchCursor(db, player.puuid, nowMs, highestStart || null);

  let rankSnapshot = false;
  if (opts.fetchRank) {
    try {
      const entries = await getLeagueEntriesByPuuid(client, platform, player.puuid);
      insertRankSnapshot(db, player.puuid, entries, nowMs);
      setIngestRankAt(db, player.puuid, nowMs);
      rankSnapshot = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(pc.yellow(`  ${label} rank: ${msg}`));
    }
  }

  let masteryRefreshed = false;
  if (opts.fetchMastery) {
    const lastMastery = state?.lastMasteryAt ?? 0;
    if (nowMs - lastMastery >= opts.masteryStaleMs) {
      try {
        const m = await getChampionMasteriesByPuuid(client, platform, player.puuid);
        upsertMastery(db, player.puuid, m);
        setIngestMasteryAt(db, player.puuid, nowMs);
        masteryRefreshed = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(pc.yellow(`  ${label} mastery: ${msg}`));
      }
    }
  }

  const bits = [`+${newMatches} matches`];
  if (timelines) bits.push(`+${timelines} timelines`);
  if (rankSnapshot) bits.push("rank");
  if (masteryRefreshed) bits.push("mastery");
  console.error(pc.green(`✓ ${label}: ${bits.join(", ")}${skipped ? ` (${skipped} dup)` : ""}`));

  return { player, newMatches, skipped, timelines, rankSnapshot, masteryRefreshed };
}
