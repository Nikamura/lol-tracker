import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { PLATFORM_TO_REGION } from "../config.js";
import type { DB } from "../db/connect.js";
import {
  FLEX_QUEUE,
  SOLO_QUEUE,
  getChampionStats,
  getCurrentRank,
  getHeadline,
  getRecentMatches,
  getRoleStats,
  summarizeRecentMatch,
} from "../db/profile-queries.js";
import {
  getIngestState,
  lastPlayedByPuuid,
  listPlayers,
  queryMatchDetail,
} from "../db/queries.js";
import { players, type Player } from "../db/schema.js";
import { parseSince, QUEUE_GROUPS, resolveQueueFilter } from "../lib/queues.js";
import { serveApiDocs } from "./docs.js";

const emptyQuery = z.object({}).strict();
const resolveQuery = z.object({
  gameName: z.string().trim().min(1).max(100),
  tagLine: z.string().trim().min(1).max(100),
  platform: z.string().trim().toLowerCase()
    .refine((v) => Object.hasOwn(PLATFORM_TO_REGION, v), "Unknown platform").optional(),
}).strict();
const profileQuery = z.object({
  since: z.string().regex(/^(all|[1-9]\d{0,5}[dhm])$/).default("30d"),
  queue: z.string().trim().toLowerCase().refine(
    (v) => v === "all" || Object.hasOwn(QUEUE_GROUPS, v) || /^\d{1,6}$/.test(v),
    "Expected a queue name or nonnegative integer queue ID",
  ).default("all"),
  recentLimit: z.string().regex(/^\d+$/).transform(Number)
    .pipe(z.number().int().min(1).max(50)).default("10"),
}).strict();

function error(code: string, message: string) {
  return { error: { code, message } };
}

function result<T>(data: T) {
  return { data, meta: { generatedAt: Date.now(), source: "cached" as const } };
}

function playerSummary(db: DB, player: Player, lastPlayedAt: number | null) {
  const state = getIngestState(db, player.puuid);
  return {
    puuid: player.puuid,
    gameName: player.gameName,
    tagLine: player.tagLine,
    riotId: `${player.gameName}#${player.tagLine}`,
    displayName: player.displayName,
    platform: player.platform,
    region: player.region,
    profilePath: `/players/${encodeURIComponent(player.puuid)}`,
    lastPlayedAt,
    lastPolledAt: state?.lastPolledAt ?? null,
    lastRankAt: state?.lastRankAt ?? null,
    lastMasteryAt: state?.lastMasteryAt ?? null,
  };
}

/** Public, read-only API backed by cached tracker data. */
export function createApi(db: DB) {
  const api = new Hono();

  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Link", '</API.md>; rel="describedby"; type="text/markdown"');
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      c.header("Allow", "GET, HEAD");
      return c.json(error("method_not_allowed", "This API is read-only."), 405);
    }
    await next();
  });

  api.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json(error("invalid_query", "Invalid query parameters."), 400);
    }
    console.error("[api] request failed", err);
    return c.json(error("internal_error", "Could not read tracker data."), 500);
  });

  api.get("/API.md", serveApiDocs);

  api.get("/players", (c) => {
    emptyQuery.parse(c.req.query());
    const lastPlayed = lastPlayedByPuuid(db);
    return c.json(result(listPlayers(db).map((p) =>
      playerSummary(db, p, lastPlayed.get(p.puuid) ?? null),
    )));
  });

  // Full Riot ID resolution is explicit: never guess using display-name substrings.
  api.get("/players/resolve", (c) => {
    const query = resolveQuery.parse(c.req.query());
    const found = listPlayers(db).filter((p) =>
      p.gameName.toLowerCase() === query.gameName.toLowerCase()
      && p.tagLine.toLowerCase() === query.tagLine.toLowerCase()
      && (!query.platform || p.platform.toLowerCase() === query.platform),
    );
    if (found.length > 1) {
      return c.json(error("ambiguous_player", "Multiple tracked accounts match; specify platform or use the roster PUUID."), 409);
    }
    const player = found[0];
    if (!player) return c.json(error("player_not_found", "Tracked player not found."), 404);
    return c.json(result(playerSummary(db, player, lastPlayedByPuuid(db).get(player.puuid) ?? null)));
  });

  api.get("/players/:puuid", (c) => {
    const query = profileQuery.parse(c.req.query());
    const player = db.select().from(players).where(eq(players.puuid, c.req.param("puuid"))).get();
    if (!player) return c.json(error("player_not_found", "Tracked player not found."), 404);
    const opts = {
      sinceMs: parseSince(query.since === "all" ? undefined : query.since),
      queueIds: resolveQueueFilter(query.queue === "all" ? undefined : query.queue),
    };
    const data = {
      player: playerSummary(db, player, lastPlayedByPuuid(db).get(player.puuid) ?? null),
      currentRank: {
        solo: getCurrentRank(db, player.puuid, SOLO_QUEUE) ?? null,
        flex: getCurrentRank(db, player.puuid, FLEX_QUEUE) ?? null,
      },
      headline: getHeadline(db, player.puuid, opts),
      roles: getRoleStats(db, player.puuid, opts).sort((a, b) => b.games - a.games),
      champions: getChampionStats(db, player.puuid, opts, 5),
      recentMatches: getRecentMatches(db, player.puuid, opts, query.recentLimit).map(summarizeRecentMatch),
    };
    const response = result(data);
    return c.json({
      ...response,
      meta: {
        ...response.meta,
        since: query.since,
        sinceMs: opts.sinceMs ?? null,
        queue: query.queue,
        queueIds: opts.queueIds ?? null,
        recentLimit: query.recentLimit,
      },
    });
  });

  api.get("/matches/:matchId", (c) => {
    emptyQuery.parse(c.req.query());
    const match = queryMatchDetail(db, c.req.param("matchId"));
    if (!match) return c.json(error("match_not_found", "Match not found."), 404);
    return c.json(result(match));
  });

  // Keep unknown API paths JSON even when mounted ahead of the HTML router.
  api.all("*", (c) => c.json(error("not_found", "API endpoint not found."), 404));
  return api;
}
