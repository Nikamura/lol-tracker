import { sql } from "drizzle-orm";
import { matchParticipants, matches } from "./schema.js";

/**
 * Remake = the game ended via the early-surrender mechanism (disconnect in the
 * first ~4 minutes) and lasted under 5 minutes. Both flags are OR'd because
 * `team_early_surrendered` is only set on the surrendering team's participants
 * while `game_ended_in_early_surrender` is set on all 10 — either tells us the
 * match was a remake.
 *
 * Apply via `.where(notRemakeCond())` (or AND it with existing conds) on every
 * query that joins matches × match_participants for stats, leaderboards,
 * streaks, comparisons, timelines or heatmaps. Remakes stay in the DB but are
 * never surfaced.
 */
export const notRemakeCond = () =>
  sql`NOT ((COALESCE(${matchParticipants.gameEndedInEarlySurrender}, 0) = 1 OR COALESCE(${matchParticipants.teamEarlySurrendered}, 0) = 1) AND ${matches.gameDuration} < 300)`;
