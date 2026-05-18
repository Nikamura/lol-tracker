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
import { parseSince, resolveQueueFilter } from "../lib/queues.js";
import { Layout } from "./layout.js";
import { MatchTabs, type TabKey } from "./pages/match-tabs.js";
import { PlayersPage } from "./pages/players.js";
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

  return app;
}
