import fs from "node:fs";
import { openDb } from "../src/db/connect.js";
import {
  compressRankHistory,
  countChampionStats,
  countMastery,
  countRecentMatches,
  getChampionStats,
  getImprovementSignals,
  getMasteryTop,
  getProfileData,
  getRankHistory,
  getRecentMatches,
  summarizeRecentMatch,
  type RankSnapshotPoint,
} from "../src/db/profile-queries.js";
import {
  insertMatch,
  insertRankSnapshot,
  setIngestMatchCursor,
  upsertMastery,
  upsertPlayer,
} from "../src/db/queries.js";
import { Match } from "../src/riot/types.js";

const DB_PATH = "/tmp/lol-tracker-smoke-profile.db";
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

const buildMatch = (
  idSuffix: string,
  startOffset: number,
  championName: string,
  championId: number,
  win: boolean,
  kills: number,
  deaths: number,
  assists: number,
  teamPosition: string,
  surrender = false,
  earlySurrender = false,
) =>
  Match.parse({
    metadata: { dataVersion: "2", matchId: `EUW1_${idSuffix}`, participants: ["P1"] },
    info: {
      gameCreation: now - startOffset - 1000,
      gameStartTimestamp: now - startOffset,
      gameEndTimestamp: now - startOffset + 1_800_000,
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
          championId,
          championName,
          champLevel: 16,
          teamId: 100,
          teamPosition,
          individualPosition: teamPosition,
          win,
          kills,
          deaths,
          assists,
          goldEarned: 13500,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          visionScore: 24,
          totalDamageDealtToChampions: 22000,
          item0: 6655,
          item1: 3020,
          item2: 3157,
          item3: 4645,
          item6: 3340,
          gameEndedInSurrender: surrender,
          gameEndedInEarlySurrender: earlySurrender,
          teamEarlySurrendered: earlySurrender,
          summoner1Id: 4,
          summoner2Id: 14,
          perks: {
            statPerks: { defense: 5002, flex: 5008, offense: 5005 },
            styles: [
              {
                description: "primaryStyle",
                style: 8200,
                selections: [
                  { perk: 8214, var1: 1, var2: 2, var3: 3 },
                  { perk: 8226, var1: 0, var2: 0, var3: 0 },
                ],
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

// 20 games inserted oldest → newest. Last 5 are Yasuo losses with deaths=8 so
// the "recent" deaths-trend is positive.
//  - 12 on Annie/MIDDLE: 4 wins, 8 losses → 33% WR (oldest)
//  - 3  on Olaf/JUNGLE:  3 wins → 100% WR (best role + best champ)
//  - 5  on Yasuo/MIDDLE: 1 win, 4 losses → 20% WR (worst champ; newest)
const sequence: Array<{ champ: string; champId: number; pos: string; win: boolean; k: number; d: number; a: number; surrender?: boolean; earlySurrender?: boolean }> = [];
for (let i = 0; i < 12; i++)
  sequence.push({ champ: "Annie", champId: 1, pos: "MIDDLE", win: i < 4, k: 5, d: 3, a: 7 });
for (let i = 0; i < 3; i++)
  sequence.push({
    champ: "Olaf",
    champId: 2,
    pos: "JUNGLE",
    win: true,
    k: 10,
    d: 2,
    a: 4,
    surrender: i === 0,
    earlySurrender: i === 0,
  });
for (let i = 0; i < 5; i++)
  sequence.push({
    champ: "Yasuo",
    champId: 157,
    pos: "MIDDLE",
    win: i === 0,
    k: 4,
    d: 8,
    a: 3,
  });

sequence.forEach((m, i) => {
  // Oldest first: largest startOffset.
  const startOffset = (sequence.length - i) * 3_600_000;
  insertMatch(
    db,
    buildMatch(
      `${String(i).padStart(3, "0")}`,
      startOffset,
      m.champ,
      m.champId,
      m.win,
      m.k,
      m.d,
      m.a,
      m.pos,
      m.surrender ?? false,
      m.earlySurrender ?? false,
    ),
  );
});

setIngestMatchCursor(db, "P1", now, now - 3_600_000);

// Rank history: many flat snapshots at GOLD II 72 LP, then promotion to GOLD I 30 LP,
// then more flat, then back to GOLD II 50 LP, more flat. Compress should keep ~5 rows.
const rankPoints: Array<{ tier: string; rank: string; lp: number; t: number }> = [];
for (let i = 0; i < 50; i++) rankPoints.push({ tier: "GOLD", rank: "II", lp: 72, t: now - (200 - i) * 60_000 });
rankPoints.push({ tier: "GOLD", rank: "I", lp: 30, t: now - 140 * 60_000 });
for (let i = 0; i < 50; i++) rankPoints.push({ tier: "GOLD", rank: "I", lp: 30, t: now - (130 - i) * 60_000 });
rankPoints.push({ tier: "GOLD", rank: "II", lp: 50, t: now - 70 * 60_000 });
for (let i = 0; i < 50; i++) rankPoints.push({ tier: "GOLD", rank: "II", lp: 50, t: now - (60 - i) * 60_000 });

for (const p of rankPoints) {
  insertRankSnapshot(
    db,
    "P1",
    [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: p.tier,
        rank: p.rank,
        leaguePoints: p.lp,
        wins: 60,
        losses: 55,
        hotStreak: false,
        veteran: false,
        freshBlood: false,
        inactive: false,
      },
    ],
    p.t,
  );
}

upsertMastery(db, "P1", [
  { puuid: "P1", championId: 1, championPoints: 250000, championLevel: 7, lastPlayTime: now },
  { puuid: "P1", championId: 2, championPoints: 150000, championLevel: 6, lastPlayTime: now },
  { puuid: "P1", championId: 157, championPoints: 100000, championLevel: 5, lastPlayTime: now },
  { puuid: "P1", championId: 99, championPoints: 50000, championLevel: 4, lastPlayTime: now },
]);

// Test 1: full profile still works for the web caller.
const full = getProfileData(db, "P1");
console.assert(full !== undefined, "full profile resolves");
console.assert(full!.recentMatches.length === 10, `recentMatches default 10, got ${full!.recentMatches.length}`);

// Test 2: compressed rank history dedupes flat runs.
const rankSolo = getRankHistory(db, "P1", "RANKED_SOLO_5x5");
const compressed = compressRankHistory(rankSolo);
console.assert(rankSolo.length >= 150, `raw rank history is ${rankSolo.length}, expected lots`);
console.assert(compressed.length <= 6, `compressed should be tiny, got ${compressed.length}`);
console.assert(compressed[0]!.capturedAt === rankSolo[0]!.capturedAt, "compressed keeps first");
console.assert(
  compressed[compressed.length - 1]!.capturedAt === rankSolo[rankSolo.length - 1]!.capturedAt,
  "compressed keeps last",
);

// Test 3: summarizeRecentMatch drops the heavy fields.
const recent = getRecentMatches(db, "P1", {}, 1);
const summary = summarizeRecentMatch(recent[0]!);
console.assert(!("item0" in summary), "summary drops item0");
console.assert(!("perksKeystone" in summary), "summary drops perksKeystone");
console.assert("kda" in summary, "summary adds kda");
console.assert("cs" in summary, "summary adds cs");

// Test 4: pagination — getRecentMatches with offset returns next page.
const totalMatches = countRecentMatches(db, "P1", {});
console.assert(totalMatches === 20, `expected 20 matches total, got ${totalMatches}`);
const page1 = getRecentMatches(db, "P1", {}, 5, 0);
const page2 = getRecentMatches(db, "P1", {}, 5, 5);
console.assert(page1.length === 5 && page2.length === 5, "5+5 = 10");
console.assert(
  page1[0]!.matchId !== page2[0]!.matchId,
  "page2 starts after page1",
);

// Test 5: champion stats pagination.
const totalChamps = countChampionStats(db, "P1", {});
console.assert(totalChamps === 3, `3 distinct champs, got ${totalChamps}`);
const champPage = getChampionStats(db, "P1", {}, 2, 0);
console.assert(champPage.length === 2, "champ page size honored");

// Test 6: mastery pagination.
const totalMastery = countMastery(db, "P1");
console.assert(totalMastery === 4, `4 mastery rows, got ${totalMastery}`);
const masteryPage = getMasteryTop(db, "P1", 2, 0);
console.assert(masteryPage.length === 2, "mastery page size honored");
const masteryPage2 = getMasteryTop(db, "P1", 2, 2);
console.assert(masteryPage2.length === 2, "mastery page 2 size honored");
console.assert(
  masteryPage[0]!.championId !== masteryPage2[0]!.championId,
  "mastery page 2 starts after page 1",
);

// Test 7: improvement signals computes worst role / champ / surrender / deaths trend.
const signals = getImprovementSignals(db, "P1", {});
console.assert(signals.windowGames === 20, `windowGames should be 20, got ${signals.windowGames}`);
console.assert(
  signals.worstWinrateChampion?.championName === "Yasuo",
  `worst champ should be Yasuo (1/5 WR), got ${signals.worstWinrateChampion?.championName}`,
);
console.assert(
  signals.bestWinrateChampion?.championName === "Olaf",
  `best champ should be Olaf (100% WR), got ${signals.bestWinrateChampion?.championName}`,
);
console.assert(
  signals.worstWinrateRole?.position === "MIDDLE",
  `worst role should be MIDDLE, got ${signals.worstWinrateRole?.position}`,
);
console.assert(
  signals.bestWinrateRole?.position === "JUNGLE",
  `best role should be JUNGLE, got ${signals.bestWinrateRole?.position}`,
);
console.assert(
  signals.surrenderRate > 0 && signals.surrenderRate <= 1,
  `surrender rate should be in (0,1], got ${signals.surrenderRate}`,
);
// Most recent 5 are all Yasuo deaths=8; prior 10 mixed
console.assert(
  signals.avgDeathsRecent === 8,
  `avg deaths recent should be 8 (Yasuo run), got ${signals.avgDeathsRecent}`,
);
console.assert(
  signals.avgDeathsDelta > 0,
  `delta should be positive (trending worse), got ${signals.avgDeathsDelta}`,
);
console.assert(
  signals.last10Form !== null,
  "last10Form should be set when N>=1",
);

db.$client.close();

console.log("profile-smoke ok — compression, pagination, summary, improvementSignals all work");
