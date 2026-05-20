import { serve, type ServerType } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/connect.js";
import { getLeaderboards } from "../db/leaderboard-queries.js";
import {
  FLEX_QUEUE,
  SOLO_QUEUE,
  compressRankHistory,
  countChampionStats,
  countMastery,
  countRecentMatches,
  getChampionStats,
  getCurrentSoloRank,
  getHeadline,
  getImprovementSignals,
  getLatestGameVersion,
  getMasteryTop,
  getRankHistory,
  getRecentMatches,
  getRoleStats,
  summarizeRecentMatch,
  type Paginated,
} from "../db/profile-queries.js";
import {
  listPlayers,
  queryMatchDetail,
  queryParties,
  queryTimeline,
  type TimelineFilter,
} from "../db/queries.js";
import { players } from "../db/schema.js";
import { parseSince, resolveQueueFilter } from "../lib/queues.js";

/**
 * Resolve a mix of puuids and display/game-name needles into a concrete puuid
 * list. Names match the same way as the CLI's `timeline --player` flag:
 * case-insensitive substring against displayName or gameName.
 */
function resolvePuuids(
  db: DB,
  opts: { puuids?: string[] | undefined; players?: string[] | undefined },
): string[] | undefined {
  const out = new Set<string>();
  if (opts.puuids?.length) for (const p of opts.puuids) out.add(p);
  if (opts.players?.length) {
    const all = listPlayers(db);
    for (const needle of opts.players) {
      const lower = needle.toLowerCase();
      const matches = all.filter(
        (p) =>
          (p.displayName?.toLowerCase().includes(lower) ?? false) ||
          p.gameName.toLowerCase().includes(lower) ||
          p.puuid === needle,
      );
      if (matches.length === 0) throw new Error(`No tracked player matches '${needle}'`);
      for (const m of matches) out.add(m.puuid);
    }
  }
  return out.size > 0 ? [...out] : undefined;
}

function buildTimelineFilter(
  db: DB,
  input: {
    since?: string | undefined;
    sinceMs?: number | undefined;
    untilMs?: number | undefined;
    puuids?: string[] | undefined;
    players?: string[] | undefined;
    queue?: string | undefined;
    limit?: number | undefined;
  },
): TimelineFilter {
  const filter: TimelineFilter = {};
  const sinceMs = input.sinceMs ?? parseSince(input.since);
  if (sinceMs !== undefined) filter.sinceMs = sinceMs;
  if (input.untilMs !== undefined) filter.untilMs = input.untilMs;
  const puuids = resolvePuuids(db, { puuids: input.puuids, players: input.players });
  if (puuids) filter.puuids = puuids;
  const queueIds = resolveQueueFilter(input.queue);
  if (queueIds) filter.queueIds = queueIds;
  if (input.limit !== undefined) filter.limit = input.limit;
  return filter;
}

const FILTER_SHAPE = {
  since: z
    .string()
    .optional()
    .describe("Relative window like '7d', '12h', '30m'. Ignored if sinceMs is set."),
  sinceMs: z.number().int().optional().describe("Lower bound on gameStart (epoch ms)."),
  untilMs: z.number().int().optional().describe("Upper bound on gameStart (epoch ms)."),
  puuids: z.array(z.string()).optional().describe("Filter to these exact PUUIDs."),
  players: z
    .array(z.string())
    .optional()
    .describe("Filter by displayName or gameName (case-insensitive substring)."),
  queue: z
    .string()
    .optional()
    .describe("Queue filter: 'soloq', 'flex', 'ranked', 'normal', 'aram', 'arena', or numeric id."),
  limit: z.number().int().positive().max(1000).optional().describe("Max rows (default 100)."),
};

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function pageOf<T>(
  items: T[],
  totalCount: number,
  offset: number,
  limit: number,
): Paginated<T> {
  const hasMore = offset + items.length < totalCount;
  return {
    items,
    totalCount,
    hasMore,
    nextOffset: hasMore ? offset + items.length : null,
  };
}

const READONLY_SQL = /^\s*(select|with)\b/i;
const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|attach|detach|create|replace|pragma|vacuum|reindex)\b/i;

export function createLolTrackerMcpServer(db: DB): McpServer {
  const server = new McpServer(
    { name: "lol-tracker", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_players",
    {
      description:
        "List every tracked player with their Riot ID, platform, and per-player ingest cursors (last polled / last match start).",
      inputSchema: {},
    },
    async () => jsonResult(listPlayers(db)),
  );

  server.registerTool(
    "query_timeline",
    {
      description:
        "Chronological feed of matches across tracked players, newest first. One row per (match, tracked participant). Use this for 'recent games', 'games where X played Y', or any per-game lookup.",
      inputSchema: FILTER_SHAPE,
    },
    async (args) => jsonResult(queryTimeline(db, buildTimelineFilter(db, args))),
  );

  server.registerTool(
    "query_parties",
    {
      description:
        "Same data as query_timeline but grouped by (matchId, teamId) so games played as a stack appear as a single party row with all tracked members nested under it.",
      inputSchema: FILTER_SHAPE,
    },
    async (args) => jsonResult(queryParties(db, buildTimelineFilter(db, args))),
  );

  server.registerTool(
    "get_match",
    {
      description:
        "Full per-participant breakdown of a single match (all 10 players, both teams) — KDA, items, damage, vision, gold, build. Includes opponents, not just tracked friends.",
      inputSchema: {
        matchId: z.string().describe("e.g. 'EUW1_7234567890'"),
      },
    },
    async ({ matchId }) => {
      const detail = queryMatchDetail(db, matchId);
      if (!detail) {
        return {
          content: [{ type: "text" as const, text: `Match ${matchId} not found.` }],
          isError: true,
        };
      }
      return jsonResult(detail);
    },
  );

  const PROFILE_SECTIONS = [
    "headline",
    "currentRank",
    "rankHistory",
    "roles",
    "champions",
    "mastery",
    "recentMatches",
    "improvementSignals",
  ] as const;
  const DEFAULT_PROFILE_INCLUDE = [
    "headline",
    "currentRank",
    "roles",
    "champions",
    "recentMatches",
    "improvementSignals",
  ] as const;

  server.registerTool(
    "get_player_profile",
    {
      description:
        "Per-player aggregate. Returns a lean default set (headline winrate/KDA, current solo rank, role distribution, top 5 champions, last 5 matches as summaries, and a pre-computed improvementSignals block). Use `include` to opt sections in/out, per-section `*Limit`/`*Offset` to page through, and `recentMatchesDetail`/`rankHistoryDetail` to switch to full rows when needed. For pointed questions ('last game played', 'who did Mangirdas duo with last week') prefer `query_sql` — it's faster and never overflows.",
      inputSchema: {
        player: z
          .string()
          .describe("PUUID, displayName, or gameName (substring). Must resolve to exactly one player."),
        since: z.string().optional().describe("Limit aggregates to this window (e.g. '30d')."),
        queue: z.string().optional().describe("Queue filter (see query_timeline)."),
        include: z
          .array(z.enum(PROFILE_SECTIONS))
          .optional()
          .describe(
            `Sections to include. Default: ${DEFAULT_PROFILE_INCLUDE.join(", ")}. ` +
              `Available: ${PROFILE_SECTIONS.join(", ")}. ` +
              "rankHistory and mastery are off by default because they're the largest sections.",
          ),
        recentMatchesLimit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Page size for recentMatches (default 10)."),
        recentMatchesOffset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Skip this many recentMatches before returning (default 0)."),
        recentMatchesDetail: z
          .enum(["summary", "full"])
          .optional()
          .describe(
            "summary (default) = champ/role/KDA/win/duration/queue only. full = every projected column including item & perk IDs. Use `get_match` for opponent rows.",
          ),
        championLimit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size for champions (default 5)."),
        championOffset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Skip this many champion rows before returning (default 0)."),
        masteryLimit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size for mastery (default 5)."),
        masteryOffset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Skip this many mastery rows before returning (default 0)."),
        rankHistoryDetail: z
          .enum(["compressed", "full"])
          .optional()
          .describe(
            "compressed (default) emits only snapshots where tier/division/LP changed plus first+last. full emits every poll snapshot — can be thousands of rows for an active player.",
          ),
      },
    },
    async (args) => {
      const {
        player,
        since,
        queue,
        include,
        recentMatchesLimit,
        recentMatchesOffset,
        recentMatchesDetail,
        championLimit,
        championOffset,
        masteryLimit,
        masteryOffset,
        rankHistoryDetail,
      } = args;
      const puuids = resolvePuuids(db, { players: [player] });
      if (!puuids || puuids.length !== 1) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                puuids === undefined
                  ? `No tracked player matches '${player}'.`
                  : `'${player}' is ambiguous; resolved to ${puuids.length} players. Use a more specific name or a PUUID.`,
            },
          ],
          isError: true,
        };
      }
      const puuid = puuids[0]!;
      const playerRow = db.select().from(players).where(eq(players.puuid, puuid)).get();
      if (!playerRow) {
        return {
          content: [{ type: "text" as const, text: `Player ${puuid} not found.` }],
          isError: true,
        };
      }

      const sinceMs = parseSince(since);
      const queueIds = resolveQueueFilter(queue);
      const opts: { sinceMs?: number; queueIds?: number[] } = {};
      if (sinceMs !== undefined) opts.sinceMs = sinceMs;
      if (queueIds) opts.queueIds = queueIds;

      const want = new Set<(typeof PROFILE_SECTIONS)[number]>(
        include && include.length > 0 ? include : DEFAULT_PROFILE_INCLUDE,
      );
      const detail = recentMatchesDetail ?? "summary";
      const matchesLimit = recentMatchesLimit ?? 10;
      const matchesOffset = recentMatchesOffset ?? 0;
      const champLimit = championLimit ?? 5;
      const champOffset = championOffset ?? 0;
      const mLimit = masteryLimit ?? 5;
      const mOffset = masteryOffset ?? 0;
      const rankMode = rankHistoryDetail ?? "compressed";

      const profile: Record<string, unknown> = { player: playerRow };
      profile["latestGameVersion"] = getLatestGameVersion(db, puuid, opts);

      if (want.has("headline")) profile["headline"] = getHeadline(db, puuid, opts);

      if (want.has("currentRank")) profile["currentSoloRank"] = getCurrentSoloRank(db, puuid);

      if (want.has("rankHistory")) {
        const solo = getRankHistory(db, puuid, SOLO_QUEUE);
        const flex = getRankHistory(db, puuid, FLEX_QUEUE);
        profile["rankHistorySolo"] =
          rankMode === "full" ? solo : compressRankHistory(solo);
        profile["rankHistoryFlex"] =
          rankMode === "full" ? flex : compressRankHistory(flex);
        profile["rankHistoryDetail"] = rankMode;
        if (rankMode === "compressed") {
          profile["rankHistoryRawCounts"] = { solo: solo.length, flex: flex.length };
        }
      }

      if (want.has("roles"))
        profile["roleStats"] = getRoleStats(db, puuid, opts).sort((a, b) => b.games - a.games);

      if (want.has("champions")) {
        const items = getChampionStats(db, puuid, opts, champLimit, champOffset);
        const totalCount = countChampionStats(db, puuid, opts);
        profile["championStats"] = pageOf(items, totalCount, champOffset, champLimit);
      }

      if (want.has("mastery")) {
        const items = getMasteryTop(db, puuid, mLimit, mOffset);
        const totalCount = countMastery(db, puuid);
        profile["masteryTop"] = pageOf(items, totalCount, mOffset, mLimit);
      }

      if (want.has("recentMatches")) {
        const rows = getRecentMatches(db, puuid, opts, matchesLimit, matchesOffset);
        const totalCount = countRecentMatches(db, puuid, opts);
        const items: unknown[] = detail === "full" ? rows : rows.map(summarizeRecentMatch);
        profile["recentMatches"] = pageOf(items, totalCount, matchesOffset, matchesLimit);
        profile["recentMatchesDetail"] = detail;
      }

      if (want.has("improvementSignals"))
        profile["improvementSignals"] = getImprovementSignals(db, puuid, opts);

      profile["included"] = [...want];
      return jsonResult(profile);
    },
  );

  server.registerTool(
    "get_leaderboards",
    {
      description:
        "Group-wide leaderboards across tracked players: winrate, KDA, CS/min, vision, damage, gold, objectives, surrender rate, etc.",
      inputSchema: {
        since: z.string().optional().describe("Window like '30d' or '7d'."),
        queue: z.string().optional().describe("Queue filter (see query_timeline)."),
      },
    },
    async ({ since, queue }) => {
      const sinceMs = parseSince(since);
      const queueIds = resolveQueueFilter(queue);
      const opts: { sinceMs?: number; queueIds?: number[] } = {};
      if (sinceMs !== undefined) opts.sinceMs = sinceMs;
      if (queueIds) opts.queueIds = queueIds;
      return jsonResult(getLeaderboards(db, opts));
    },
  );

  server.registerTool(
    "query_sql",
    {
      description:
        "Read-only escape hatch: run a SELECT/WITH against the SQLite DB. Tables: players, matches, match_participants, match_timelines, player_rank_snapshots, player_mastery, ingest_state, meta. Mutating statements are rejected.",
      inputSchema: {
        sql: z.string().describe("A single SELECT or WITH statement."),
        params: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Positional bind parameters for '?' placeholders."),
        limit: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe("Hard cap on rows returned (default 500)."),
      },
    },
    async ({ sql, params, limit }) => {
      if (!READONLY_SQL.test(sql) || FORBIDDEN_SQL.test(sql)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Only single SELECT/WITH statements are allowed.",
            },
          ],
          isError: true,
        };
      }
      const cap = limit ?? 500;
      const stmt = db.$client.prepare(sql);
      const rows = stmt.all(...(params ?? [])) as unknown[];
      const truncated = rows.length > cap;
      return jsonResult({
        rowCount: rows.length,
        truncated,
        rows: truncated ? rows.slice(0, cap) : rows,
      });
    },
  );

  return server;
}

export async function runMcpServerOverStdio(db: DB): Promise<void> {
  const server = createLolTrackerMcpServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Handle one MCP HTTP request. Each call spins up a fresh transport + server:
 * the SDK forbids reusing a stateless streamable-HTTP transport across
 * requests (would cause message-id collisions), and `MCPServer` construction
 * is just zod schema registration — cheap enough to do per request.
 *
 * Designed to be mounted into any web framework — e.g. as a Hono route on the
 * existing `serve` app:
 *
 *     app.all("/mcp", (c) => handleMcpHttpRequest(db, c.req.raw));
 */
export async function handleMcpHttpRequest(db: DB, req: Request): Promise<Response> {
  const server = createLolTrackerMcpServer(db);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } finally {
    await server.close().catch(() => {});
  }
}

export interface HttpServerHandle {
  server: ServerType;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Stand-alone HTTP host for the MCP server. Used by `lol-tracker mcp` when
 * launched outside of `serve`; the `serve` command mounts `handleMcpHttpRequest`
 * directly on its existing Hono app instead.
 */
export async function runMcpServerOverHttp(
  db: DB,
  opts: { port: number; host?: string; path?: string },
): Promise<HttpServerHandle> {
  const mcpPath = opts.path ?? "/mcp";
  const host = opts.host ?? "127.0.0.1";

  const fetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname !== mcpPath) {
      return new Response("Not Found", { status: 404 });
    }
    return handleMcpHttpRequest(db, req);
  };

  return await new Promise<HttpServerHandle>((resolve) => {
    const httpServer = serve({ fetch: fetchHandler, port: opts.port, hostname: host }, (info) => {
      const url = `http://${host}:${info.port}${mcpPath}`;
      resolve({
        server: httpServer,
        port: info.port,
        url,
        close: () =>
          new Promise<void>((res, rej) => {
            httpServer.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
