/**
 * End-to-end smoke for the MCP `get_player_profile` tool: spins up an in-memory
 * DB, registers the server, and invokes the tool through the registered
 * dispatch. Verifies the lean default, that includes/limits/offsets actually
 * shape the response, and that the pagination metadata is correct.
 */
import fs from "node:fs";
import { openDb } from "../src/db/connect.js";
import { createLolTrackerMcpServer } from "../src/mcp/server.js";
import {
  insertMatch,
  insertRankSnapshot,
  setIngestMatchCursor,
  upsertMastery,
  upsertPlayer,
} from "../src/db/queries.js";
import { Match } from "../src/riot/types.js";

const DB_PATH = "/tmp/lol-tracker-smoke-mcp.db";
for (const suffix of ["", "-shm", "-wal"]) {
  fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
}
const db = openDb(DB_PATH);

upsertPlayer(db, {
  puuid: "P1",
  gameName: "Alice",
  tagLine: "EUW",
  platform: "euw1",
  region: "europe",
  displayName: "Alice",
});

const now = Date.now();
const buildMatch = (suffix: string, off: number, win: boolean) =>
  Match.parse({
    metadata: { dataVersion: "2", matchId: `EUW1_${suffix}`, participants: ["P1"] },
    info: {
      gameCreation: now - off - 1000,
      gameStartTimestamp: now - off,
      gameEndTimestamp: now - off + 1_800_000,
      gameDuration: 1800,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      queueId: 420,
      gameVersion: "14.5.123",
      mapId: 11,
      platformId: "EUW1",
      participants: [
        {
          puuid: "P1",
          participantId: 1,
          championId: 1,
          championName: "Annie",
          champLevel: 16,
          teamId: 100,
          teamPosition: "MIDDLE",
          individualPosition: "MIDDLE",
          win,
          kills: 5,
          deaths: 3,
          assists: 7,
          goldEarned: 13500,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          visionScore: 24,
          totalDamageDealtToChampions: 22000,
          item0: 6655,
          item1: 3020,
          gameEndedInSurrender: false,
          gameEndedInEarlySurrender: false,
          teamEarlySurrendered: false,
          summoner1Id: 4,
          summoner2Id: 14,
          perks: {
            statPerks: { defense: 5002, flex: 5008, offense: 5005 },
            styles: [
              {
                description: "primaryStyle",
                style: 8200,
                selections: [{ perk: 8214, var1: 1, var2: 2, var3: 3 }],
              },
              {
                description: "subStyle",
                style: 8100,
                selections: [{ perk: 8126, var1: 0, var2: 0, var3: 0 }],
              },
            ],
          },
          riotIdGameName: "Alice",
          riotIdTagline: "EUW",
          summonerLevel: 200,
        },
      ],
      teams: [{ teamId: 100, win, bans: [], objectives: {} }],
    },
  });

for (let i = 0; i < 15; i++) {
  insertMatch(db, buildMatch(String(i).padStart(3, "0"), (15 - i) * 3_600_000, i % 2 === 0));
}
setIngestMatchCursor(db, "P1", now, now - 3_600_000);

// 200 flat rank snapshots so we can see the compression effect end-to-end.
for (let i = 0; i < 200; i++) {
  insertRankSnapshot(
    db,
    "P1",
    [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "GOLD",
        rank: "II",
        leaguePoints: 72,
        wins: 60,
        losses: 55,
        hotStreak: false,
        veteran: false,
        freshBlood: false,
        inactive: false,
      },
    ],
    now - (200 - i) * 60_000,
  );
}

upsertMastery(db, "P1", [
  { puuid: "P1", championId: 1, championPoints: 250000, championLevel: 7, lastPlayTime: now },
]);

const server = createLolTrackerMcpServer(db);
// The McpServer SDK doesn't expose a clean public "invoke this tool" function,
// but `(server as any)._registeredTools` is the registry used by the dispatch.
// We pull the handler directly to avoid setting up a full JSON-RPC roundtrip.
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;
const registry = (server as unknown as {
  _registeredTools: Record<string, { handler: ToolHandler }>;
})._registeredTools;
const profileTool = registry["get_player_profile"];
if (!profileTool) throw new Error("get_player_profile not registered");

const parse = async (args: Record<string, unknown>) => {
  const r = await profileTool.handler(args);
  if (r.isError) throw new Error(`tool errored: ${r.content[0]?.text}`);
  return JSON.parse(r.content[0]!.text);
};

// 1. Lean default — no rank history, no mastery, only 5 recent matches (summary)
const lean = await parse({ player: "Alice" });
console.assert(lean.player.puuid === "P1");
console.assert(lean.headline, "headline present in default");
console.assert(lean.currentSoloRank === undefined || lean.currentSoloRank === null || typeof lean.currentSoloRank === "object", "currentSoloRank section present");
console.assert(lean.improvementSignals, "improvementSignals present by default");
console.assert(!("rankHistorySolo" in lean), "rankHistory excluded by default");
console.assert(!("masteryTop" in lean), "mastery excluded by default");
console.assert(lean.recentMatches.items.length === 10, `recent default 10, got ${lean.recentMatches.items.length}`);
console.assert(lean.recentMatches.totalCount === 15, "totalCount surfaces 15");
console.assert(lean.recentMatches.hasMore === true, "hasMore=true with more pages");
console.assert(lean.recentMatches.nextOffset === 10, "nextOffset is current offset + items length");
console.assert(!("item0" in lean.recentMatches.items[0]), "summary excludes item0");
console.assert("kda" in lean.recentMatches.items[0], "summary includes kda");
console.assert(lean.recentMatchesDetail === "summary", "default detail is summary");

// 2. Pagination cursor works.
const page2 = await parse({ player: "Alice", recentMatchesOffset: 10, recentMatchesLimit: 5 });
console.assert(page2.recentMatches.items.length === 5);
console.assert(page2.recentMatches.hasMore === false, "page 2 has no more pages");
console.assert(page2.recentMatches.nextOffset === null, "nextOffset null on terminal page");
console.assert(page2.recentMatches.items[0].matchId !== lean.recentMatches.items[0].matchId);

// 3. Full detail returns item IDs.
const fullDetail = await parse({
  player: "Alice",
  include: ["recentMatches"],
  recentMatchesDetail: "full",
  recentMatchesLimit: 1,
});
console.assert("item0" in fullDetail.recentMatches.items[0], "full detail includes item0");
console.assert(fullDetail.recentMatchesDetail === "full");

// 4. Rank history compression vs full.
const compressed = await parse({
  player: "Alice",
  include: ["rankHistory"],
});
console.assert(
  compressed.rankHistorySolo.length <= 2,
  `compressed rank history should be 1–2 rows, got ${compressed.rankHistorySolo.length}`,
);
console.assert(compressed.rankHistoryRawCounts.solo === 200);
console.assert(compressed.rankHistoryDetail === "compressed");

const fullHistory = await parse({
  player: "Alice",
  include: ["rankHistory"],
  rankHistoryDetail: "full",
});
console.assert(
  fullHistory.rankHistorySolo.length === 200,
  `full history should have 200 rows, got ${fullHistory.rankHistorySolo.length}`,
);

// 5. include controls actually whitelist sections.
const headlineOnly = await parse({ player: "Alice", include: ["headline"] });
console.assert(headlineOnly.headline, "headline present");
console.assert(!("recentMatches" in headlineOnly), "recentMatches excluded by include filter");
console.assert(!("improvementSignals" in headlineOnly), "improvementSignals excluded by include filter");

// 6. Payload size sanity check — default profile must be much smaller than full.
const defaultSize = JSON.stringify(lean).length;
const everything = await parse({
  player: "Alice",
  include: ["headline", "currentRank", "rankHistory", "roles", "champions", "mastery", "recentMatches", "improvementSignals"],
  rankHistoryDetail: "full",
  recentMatchesDetail: "full",
  recentMatchesLimit: 100,
});
const everythingSize = JSON.stringify(everything).length;
console.assert(
  defaultSize < everythingSize / 4,
  `default (${defaultSize}b) should be way smaller than everything (${everythingSize}b)`,
);
console.log(`payload sizes — default: ${defaultSize}b, everything: ${everythingSize}b`);

db.$client.close();
console.log("mcp-smoke ok — lean default, pagination, include filter, detail toggles all work");
