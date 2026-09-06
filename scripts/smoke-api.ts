import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../src/db/connect.js";
import type {
  ChampionStat,
  CurrentRank,
  ProfileHeadline,
  ProfileRecentMatchSummary,
  RoleStat,
} from "../src/db/profile-queries.js";
import {
  insertMatch,
  insertRankSnapshot,
  setIngestMasteryAt,
  setIngestMatchCursor,
  setIngestRankAt,
  upsertPlayer,
  type MatchDetail,
} from "../src/db/queries.js";
import { Match } from "../src/riot/types.js";
import { createApp } from "../src/web/server.js";

interface ApiPlayer {
  puuid: string;
  gameName: string;
  tagLine: string;
  riotId: string;
  platform: string;
  region: string;
  displayName: string | null;
  profilePath: string;
  lastPolledAt: number | null;
  lastPlayedAt: number | null;
  lastRankAt: number | null;
  lastMasteryAt: number | null;
}

interface ApiProfile {
  player: ApiPlayer;
  currentRank: { solo: CurrentRank | null; flex: CurrentRank | null };
  headline: ProfileHeadline;
  roles: RoleStat[];
  champions: ChampionStat[];
  recentMatches: ProfileRecentMatchSummary[];
}

const RAW_ONLY = "private-upstream-field-not-for-api";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lol-tracker-api-"));
let db: DB | undefined;

try {
  db = openDb(path.join(dir, "tracker.db"));
  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  for (const player of [
    { puuid: "P1", gameName: "Alice", tagLine: "EUW", displayName: "Ali" },
    { puuid: "P2", gameName: "Bob", tagLine: "EUW", displayName: null },
    { puuid: "P3", gameName: "NewPlayer", tagLine: "EUW", displayName: null },
    { puuid: "P4", gameName: "Ąžuolas", tagLine: "ŽLT", displayName: null },
  ]) {
    upsertPlayer(db, { ...player, platform: "euw1", region: "europe" });
  }

  // Ten participants exercise the shared-match shape the party bot consumes.
  const buildMatch = (id: string, age: number, queueId: number, win: boolean, remake = false) => {
    const duration = remake ? 180 : 1800;
    const participants = Array.from({ length: 10 }, (_, i) => {
      const ally = i < 5;
      const position = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5]!;
      return {
        puuid: i < 2 ? `P${i + 1}` : `untracked-${i}`,
        participantId: i + 1,
        championId: i === 0 ? (queueId === 420 ? 1 : 2) : i + 10,
        championName: i === 0 ? (queueId === 420 ? "Annie" : "Olaf") : `Champion${i}`,
        champLevel: remake ? 2 : 16,
        teamId: ally ? 100 : 200,
        teamPosition: i === 0 ? (queueId === 420 ? "MIDDLE" : "JUNGLE") : position,
        individualPosition: position,
        win: ally ? win : !win,
        kills: remake ? 0 : 6,
        deaths: remake ? 0 : 3,
        assists: remake ? 0 : 9,
        goldEarned: remake ? 700 : 13500,
        totalMinionsKilled: remake ? 5 : 180,
        neutralMinionsKilled: remake ? 0 : 12,
        visionScore: remake ? 0 : 24,
        totalDamageDealtToChampions: remake ? 100 : 22000,
        totalDamageTaken: 14000,
        damageDealtToObjectives: 9000,
        item0: 6655,
        item1: 3020,
        item6: 3340,
        summoner1Id: 4,
        summoner2Id: 14,
        gameEndedInEarlySurrender: remake,
        teamEarlySurrendered: remake && ally,
        gameEndedInSurrender: remake,
        riotIdGameName: i === 0 ? "Alice" : i === 1 ? "Bob" : `Opponent${i}`,
        riotIdTagline: "EUW",
        privateUpstreamField: RAW_ONLY,
      };
    });
    return Match.parse({
      metadata: { dataVersion: "2", matchId: id, participants: participants.map((p) => p.puuid) },
      info: {
        gameCreation: now - age - 1000,
        gameStartTimestamp: now - age,
        gameEndTimestamp: now - age + duration * 1000,
        gameDuration: duration,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        queueId,
        gameVersion: "26.17.123",
        mapId: 11,
        platformId: "EUW1",
        participants,
        teams: [
          { teamId: 100, win, bans: [], objectives: {} },
          { teamId: 200, win: !win, bans: [], objectives: {} },
        ],
      },
      privateUpstreamField: RAW_ONLY,
    });
  };

  // Twelve recent matches, one outside the default window, and a newer remake.
  for (let i = 0; i < 12; i++) {
    insertMatch(db, buildMatch(`EUW1_recent_${i}`, (i + 2) * hour, i % 2 ? 440 : 420, i % 2 === 0));
  }
  insertMatch(db, buildMatch("EUW1_old", 40 * day, 420, true));
  insertMatch(db, buildMatch("EUW1_remake", hour / 2, 420, false, true));
  setIngestMatchCursor(db, "P1", now - 60_000, now - hour / 2);
  setIngestRankAt(db, "P1", now - 120_000);
  setIngestMasteryAt(db, "P1", now - 180_000);
  insertRankSnapshot(db, "P1", [
    { queueType: "RANKED_SOLO_5x5", tier: "SILVER", rank: "I", leaguePoints: 90, wins: 20, losses: 20 },
  ], now - day);
  insertRankSnapshot(db, "P1", [
    { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "IV", leaguePoints: 21, wins: 22, losses: 20, privateUpstreamField: RAW_ONLY },
    { queueType: "RANKED_FLEX_SR", tier: "PLATINUM", rank: "II", leaguePoints: 44, wins: 30, losses: 18 },
  ], now - 120_000);

  const app = createApp(db);
  const assertSafe = (body: string) => {
    assert.ok(!body.includes(RAW_ONLY), "raw upstream fields must stay private");
    assert.ok(!body.includes('"rawJson"'), "raw JSON must not be exposed");
  };
  const success = async <T>(url: string): Promise<T> => {
    const response = await app.request(url);
    const body = await response.text();
    assert.equal(response.status, 200, `${url}: ${body}`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(response.headers.get("link"), '</API.md>; rel="describedby"; type="text/markdown"');
    assertSafe(body);
    const payload = JSON.parse(body) as { data: T; meta: { source: string; generatedAt: number } };
    assert.equal(payload.meta.source, "cached");
    assert.equal(typeof payload.meta.generatedAt, "number");
    assert.ok(payload.meta.generatedAt >= now && payload.meta.generatedAt <= Date.now());
    assert.ok("data" in payload);
    return payload.data;
  };
  const error = async (response: Response | Promise<Response>, status: number) => {
    const result = await response;
    const body = await result.text();
    assert.equal(result.status, status, body);
    assert.match(result.headers.get("content-type") ?? "", /application\/json/);
    assertSafe(body);
    const payload = JSON.parse(body) as { error: { code: string; message: string } };
    assert.equal(typeof payload.error.code, "string");
    assert.ok(payload.error.code.length > 0);
    assert.equal(typeof payload.error.message, "string");
    assert.ok(payload.error.message.length > 0);
    assert.ok(!("data" in payload));
  };

  const routes = [
    "/api/v1/players",
    "/api/v1/players/resolve?gameName=Alice&tagLine=EUW",
    "/api/v1/players/P1",
    "/api/v1/matches/EUW1_recent_0",
  ];
  // Both URLs serve the source guide verbatim, independent of process cwd.
  const guide = fs.readFileSync(new URL("../API.md", import.meta.url), "utf8");
  const originalCwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    for (const route of ["/API.md", "/api/v1/API.md"]) {
      const response = await app.request(route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.equal(await response.text(), guide, "served guide must match API.md");
      const head = await app.request(route, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
    }
  } finally {
    process.chdir(originalCwd);
  }
  for (const route of routes) {
    await success(route);
    const response = await app.request(route, { method: "HEAD" });
    assert.equal(response.status, 200, `public HEAD ${route}`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(await response.text(), "", "HEAD returns headers without a body");
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await error(app.request("/api/v1/players/P1", { method }), 405);
  }
  await error(app.request("/api/v1/unknown"), 404);
  await error(app.request("/api/v1/players/missing"), 404);
  await error(app.request("/api/v1/matches/missing"), 404);

  const roster = await success<ApiPlayer[]>("/api/v1/players");
  assert.equal(roster.length, 4, "roster contains only tracked players");
  assert.deepEqual(roster.find((p) => p.puuid === "P1"), {
    puuid: "P1", gameName: "Alice", tagLine: "EUW", riotId: "Alice#EUW",
    platform: "euw1", region: "europe", displayName: "Ali", profilePath: "/players/P1",
    lastPolledAt: now - 60_000, lastPlayedAt: now - 2 * hour,
    lastRankAt: now - 120_000, lastMasteryAt: now - 180_000,
  });
  const unpolled = roster.find((p) => p.puuid === "P3")!;
  assert.equal(unpolled.displayName, null);
  for (const key of ["lastPolledAt", "lastPlayedAt", "lastRankAt", "lastMasteryAt"] as const) {
    assert.equal(unpolled[key], null, `unpolled player ${key}`);
  }
  assert.equal(roster.find((p) => p.puuid === "P2")!.lastPlayedAt, now - 2 * hour);

  const resolved = await success<ApiPlayer>("/api/v1/players/resolve?gameName=ALICE&tagLine=euw");
  assert.equal(resolved.puuid, "P1");
  assert.equal(resolved.riotId, "Alice#EUW");
  const unicode = new URLSearchParams({ gameName: "ĄŽUOLAS", tagLine: "žlt" });
  assert.equal((await success<ApiPlayer>(`/api/v1/players/resolve?${unicode}`)).puuid, "P4");
  await error(app.request("/api/v1/players/resolve?gameName=Ali&tagLine=EUW"), 404);
  await error(app.request("/api/v1/players/resolve?gameName=Alice&tagLine=EU"), 404);
  for (const query of ["", "gameName=Alice", "gameName=&tagLine=EUW", "gameName=Alice&tagLine=EUW&platform=bad"]) {
    await error(app.request(`/api/v1/players/resolve?${query}`), 400);
  }
  upsertPlayer(db, { puuid: "duplicate", gameName: "ALICE", tagLine: "euw", platform: "eun1", region: "europe" });
  await error(app.request("/api/v1/players/resolve?gameName=Alice&tagLine=EUW"), 409);
  assert.equal((await success<ApiPlayer>("/api/v1/players/resolve?gameName=Alice&tagLine=EUW&platform=euw1")).puuid, "P1");

  const profile = await success<ApiProfile>("/api/v1/players/P1");
  assert.deepEqual(profile.player, roster.find((p) => p.puuid === "P1"));
  assert.equal(profile.currentRank.solo?.tier, "GOLD", "latest solo snapshot wins");
  assert.equal(profile.currentRank.solo?.leaguePoints, 21);
  assert.equal(profile.currentRank.flex?.tier, "PLATINUM");
  assert.equal(profile.currentRank.flex?.leaguePoints, 44);
  assert.equal(profile.headline.games, 12, "default 30 days excludes old match and remake");
  assert.equal(profile.headline.wins, 6);
  assert.equal(profile.headline.losses, 6);
  assert.equal(profile.headline.winrate, 0.5);
  assert.equal(profile.headline.avgKda, 5);
  assert.deepEqual(new Set(profile.roles.map((r) => r.position)), new Set(["MIDDLE", "JUNGLE"]));
  assert.equal(profile.roles.reduce((sum, r) => sum + r.games, 0), 12);
  assert.deepEqual(new Set(profile.champions.map((c) => c.championName)), new Set(["Annie", "Olaf"]));
  assert.equal(profile.champions.reduce((sum, c) => sum + c.games, 0), 12);
  assert.equal(profile.recentMatches.length, 10);
  assert.equal(profile.recentMatches[0]!.matchId, "EUW1_recent_0");
  assert.equal(profile.recentMatches[0]!.cs, 192);
  assert.equal(profile.recentMatches[0]!.kda, 5);
  assert.ok(!("item0" in profile.recentMatches[0]!));

  for (const [query, games] of [
    ["since=all", 13], ["since=1d", 12], ["since=4h", 2], ["since=180m", 1],
    ["queue=all", 12], ["queue=ranked", 12], ["queue=soloq", 6], ["queue=flex", 6],
    ["queue=420", 6], ["queue=normal", 0], ["queue=0", 0], ["since=all&queue=soloq", 7],
  ] as const) {
    const filtered = await success<ApiProfile>(`/api/v1/players/P1?${query}&recentLimit=50`);
    assert.equal(filtered.headline.games, games, query);
    assert.equal(filtered.recentMatches.length, games, `${query} recent matches`);
    assert.equal(filtered.roles.reduce((sum, r) => sum + r.games, 0), games, `${query} roles`);
    assert.equal(filtered.champions.reduce((sum, c) => sum + c.games, 0), games, `${query} champions`);
  }
  assert.equal((await success<ApiProfile>("/api/v1/players/P1?recentLimit=1")).recentMatches.length, 1);
  for (const query of [
    "since=0d", "since=-1d", "since=banana", "queue=unknown", "queue=-1", "queue=420.5",
    "recentLimit=0", "recentLimit=51", "recentLimit=1.5", "recentLimit=oops", "unknown=true",
  ]) {
    await error(app.request(`/api/v1/players/P1?${query}`), 400);
  }

  const empty = await success<ApiProfile>("/api/v1/players/P3");
  assert.deepEqual(empty.currentRank, { solo: null, flex: null });
  assert.ok(Object.values(empty.headline).every((value) => value === 0), "empty profile has numeric zeros");
  assert.deepEqual(empty.roles, []);
  assert.deepEqual(empty.champions, []);
  assert.deepEqual(empty.recentMatches, []);

  const match = await success<MatchDetail>("/api/v1/matches/EUW1_recent_0");
  const matchPage = await app.request("/matches/EUW1_recent_0");
  assert.equal(matchPage.status, 200);
  const matchHtml = await matchPage.text();
  assert.match(matchHtml, /<html/);
  assert.match(matchHtml, /match-EUW1_recent_0-detail/);
  assert.match(matchHtml, /\/fragments\/match\/EUW1_recent_0\/stats/);
  assert.equal((await app.request("/matches/missing")).status, 404);
  assert.equal(match.matchId, "EUW1_recent_0");
  assert.equal(match.participants.length, 10);
  assert.equal(match.participants.find((p) => p.puuid === "P1")!.trackedDisplayName, "Ali");
  assert.equal(match.participants.filter((p) => p.teamId === 100).length, 5);
  assert.equal(match.participants.filter((p) => p.teamId === 200).length, 5);
  assert.equal(match.participants.find((p) => p.puuid === "P1")!.item0, 6655);

  const webResponse = await app.request("/players");
  assert.equal(webResponse.status, 200, "web roster still works alongside the public API");
  assert.match(webResponse.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await webResponse.text(), /Alice/);

  console.log("api-smoke ok — public reads, readonly methods, roster, identity resolution, filtered profiles, match detail, and web isolation");
} finally {
  db?.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
