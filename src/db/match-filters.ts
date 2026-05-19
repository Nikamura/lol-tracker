import { sql } from "drizzle-orm";
import { matches } from "./schema.js";

/**
 * Remake = a game that ended via the early-surrender mechanism (one team DCs in
 * the first ~4 minutes). Riot reports those with `gameDuration` under 5 minutes;
 * no real Summoner's Rift / ARAM / Arena game finishes that fast, so a pure
 * duration threshold is enough — and it stays correct even when the per-
 * participant `gameEndedInEarlySurrender` / `teamEarlySurrendered` flags are
 * missing on rows that were ingested before those columns were populated
 * reliably (migration 0001 backfills them from `matches.raw_json`, but the
 * predicate must work regardless).
 *
 * Apply via `.where(notRemakeCond())` (or AND it with existing conds) on every
 * query that joins `matches` for stats, leaderboards, streaks, comparisons,
 * timelines or heatmaps. Remakes stay in the DB but are never surfaced.
 */
export const notRemakeCond = () => sql`${matches.gameDuration} >= 300`;
