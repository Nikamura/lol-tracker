import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { DB } from "../db/connect.js";
import {
  getIngestState,
  getMatchRaw,
  lastPlayedByPuuid,
  listPlayers,
  queryParties,
  type TimelineFilter,
} from "../db/queries.js";
import { getProfileData } from "../db/profile-queries.js";
import { getLeaderboards } from "../db/leaderboard-queries.js";
import { streaksForAll } from "../db/streak-queries.js";
import { heatmapData } from "../db/heatmap-queries.js";
import { parseSince, resolveQueueFilter } from "../lib/queues.js";
import { Layout } from "./layout.js";
import { MatchTabs, type TabKey } from "./pages/match-tabs.js";
import { PlayersPage } from "./pages/players.js";
import { PlayerProfilePage, PlayerProfileBody } from "./pages/player-profile.js";
import { LeaderboardsPage, LeaderboardsBody } from "./pages/leaderboards.js";
import { StreaksPage, StreaksBody } from "./pages/streaks.js";
import {
  HeatmapsPage,
  HeatmapsBody,
  type HeatmapsQueue,
  type HeatmapsSince,
} from "./pages/heatmaps.js";
import { TimelinePage, TimelineRows } from "./pages/timeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.resolve(here, "..", "..", "public");

type Variables = { active?: string };

interface TimelineQuery {
  since: string;
  queue: string;
  player: string;
  limit: string;
}

function parseTimelineQuery(raw: Record<string, string | undefined>): TimelineQuery {
  return {
    since: raw.since ?? "7d",
    queue: raw.queue ?? "",
    player: raw.player ?? "",
    limit: raw.limit ?? "100",
  };
}

function buildTimelineFilter(query: TimelineQuery): TimelineFilter {
  const filter: TimelineFilter = { limit: clampLimit(query.limit) };
  const sinceMs = parseSince(query.since || undefined);
  if (sinceMs !== undefined) filter.sinceMs = sinceMs;
  const queueIds = resolveQueueFilter(query.queue || undefined);
  if (queueIds) filter.queueIds = queueIds;
  if (query.player) filter.puuids = [query.player];
  return filter;
}

function clampLimit(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 100;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

interface SinceQueueFilters {
  since: string;
  queue: string;
}

function parseSinceQueue(
  raw: Record<string, string | undefined>,
  defaultSince: string,
): SinceQueueFilters {
  return {
    since: raw.since ?? defaultSince,
    queue: raw.queue ?? "all",
  };
}

function buildSinceQueueOpts(f: SinceQueueFilters): {
  sinceMs?: number;
  queueIds?: number[];
} {
  const opts: { sinceMs?: number; queueIds?: number[] } = {};
  const since = parseSince(f.since === "all" ? undefined : f.since);
  if (since !== undefined) opts.sinceMs = since;
  const queue = resolveQueueFilter(f.queue === "all" ? undefined : f.queue);
  if (queue) opts.queueIds = queue;
  return opts;
}

const HEATMAPS_SINCE: ReadonlyArray<HeatmapsSince> = ["7d", "30d", "90d", "all"];
const HEATMAPS_QUEUE: ReadonlyArray<HeatmapsQueue> = [
  "all",
  "soloq",
  "flex",
  "ranked",
  "normal",
  "aram",
];
function coerceHeatmapsSince(s: string): HeatmapsSince {
  return (HEATMAPS_SINCE as readonly string[]).includes(s) ? (s as HeatmapsSince) : "90d";
}
function coerceHeatmapsQueue(q: string): HeatmapsQueue {
  return (HEATMAPS_QUEUE as readonly string[]).includes(q) ? (q as HeatmapsQueue) : "all";
}

export function createApp(db: DB) {
  const app = new Hono<{ Variables: Variables }>();

  app.use(
    "/static/*",
    serveStatic({ root: path.relative(process.cwd(), STATIC_ROOT), rewriteRequestPath: (p) => p.replace(/^\/static/, "") }),
  );

  app.use(
    "*",
    jsxRenderer(
      ({ children }, c) => (
        <Layout active={c.get("active")}>{children}</Layout>
      ),
      { docType: true },
    ),
  );

  app.get("/", (c) => {
    c.set("active", "timeline");
    const query = parseTimelineQuery(c.req.query());
    const parties = queryParties(db, buildTimelineFilter(query));
    const players = listPlayers(db);
    return c.render(<TimelinePage parties={parties} players={players} filters={query} />);
  });

  app.get("/fragments/timeline", (c) => {
    const query = parseTimelineQuery(c.req.query());
    const parties = queryParties(db, buildTimelineFilter(query));
    return c.html(<TimelineRows parties={parties} />);
  });

  app.get("/players", (c) => {
    c.set("active", "players");
    const players = listPlayers(db);
    const lastPlayed = lastPlayedByPuuid(db);
    const rows = players.map((player) => ({
      player,
      state: getIngestState(db, player.puuid),
      lastPlayedAt: lastPlayed.get(player.puuid) ?? null,
    }));
    return c.render(<PlayersPage rows={rows} />);
  });

  app.get("/parties", (c) => c.redirect("/"));

  const tabHandler = (active: TabKey) => (c: Context<{ Variables: Variables }>) => {
    const matchId = c.req.param("matchId");
    if (!matchId) return c.notFound();
    const raw = getMatchRaw(db, matchId);
    if (!raw) return c.notFound();
    return c.html(<MatchTabs raw={raw} active={active} />);
  };
  app.get("/fragments/match/:matchId", tabHandler("overview"));
  app.get("/fragments/match/:matchId/stats", tabHandler("stats"));
  app.get("/fragments/match/:matchId/timeline", tabHandler("timeline"));
  app.get("/fragments/match/:matchId/gold", tabHandler("gold"));

  app.get("/players/:puuid", (c) => {
    c.set("active", "players");
    const puuid = c.req.param("puuid");
    if (!puuid) return c.notFound();
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = getProfileData(db, puuid, buildSinceQueueOpts(filters));
    if (!data) return c.notFound();
    return c.render(<PlayerProfilePage data={data} filters={filters} />);
  });

  app.get("/fragments/player/:puuid", (c) => {
    const puuid = c.req.param("puuid");
    if (!puuid) return c.notFound();
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = getProfileData(db, puuid, buildSinceQueueOpts(filters));
    if (!data) return c.notFound();
    return c.html(<PlayerProfileBody data={data} />);
  });

  app.get("/leaderboards", (c) => {
    c.set("active", "leaderboards");
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = getLeaderboards(db, buildSinceQueueOpts(filters));
    return c.render(<LeaderboardsPage data={data} filters={filters} />);
  });

  app.get("/fragments/leaderboards", (c) => {
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = getLeaderboards(db, buildSinceQueueOpts(filters));
    return c.html(<LeaderboardsBody data={data} />);
  });

  app.get("/streaks", (c) => {
    c.set("active", "streaks");
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = streaksForAll(db, buildSinceQueueOpts(filters));
    return c.render(<StreaksPage data={data} filters={filters} />);
  });

  app.get("/fragments/streaks", (c) => {
    const filters = parseSinceQueue(c.req.query(), "30d");
    const data = streaksForAll(db, buildSinceQueueOpts(filters));
    return c.html(<StreaksBody data={data} />);
  });

  app.get("/heatmaps", (c) => {
    c.set("active", "heatmaps");
    const raw = parseSinceQueue(c.req.query(), "90d");
    const filters = {
      since: coerceHeatmapsSince(raw.since),
      queue: coerceHeatmapsQueue(raw.queue),
    };
    const data = heatmapData(db, buildSinceQueueOpts(raw));
    return c.render(<HeatmapsPage data={data} filters={filters} />);
  });

  app.get("/fragments/heatmaps", (c) => {
    const raw = parseSinceQueue(c.req.query(), "90d");
    const data = heatmapData(db, buildSinceQueueOpts(raw));
    return c.html(<HeatmapsBody data={data} />);
  });

  return app;
}
