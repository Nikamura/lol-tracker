import fs from "node:fs";
import { eq } from "drizzle-orm";
import { openDb } from "../src/db/connect.js";
import {
  insertMatch,
  insertMatchTimeline,
  insertRankSnapshot,
  queryTimeline,
  setIngestMatchCursor,
  upsertMastery,
  upsertPlayer,
} from "../src/db/queries.js";
import {
  KEY_FINGERPRINT_META,
  getMeta,
  keyFingerprint,
  rekeyPlayerPuuid,
  rewriteRawJsonPuuids,
  setMeta,
} from "../src/db/rekey.js";
import {
  ingestState,
  matchParticipants,
  matchTimelines,
  matches,
  playerMastery,
  playerRankSnapshots,
  players,
} from "../src/db/schema.js";
import { Match, MatchTimeline } from "../src/riot/types.js";

const DB_PATH = "/tmp/lol-tracker-smoke.db";
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
upsertPlayer(db, {
  puuid: "P2",
  gameName: "Bob",
  tagLine: "EUW",
  platform: "euw1",
  region: "europe",
  displayName: "Bob",
});

const now = Date.now();

const fakeMatch = (idSuffix: string, startOffset: number, p1Win: boolean) =>
  Match.parse({
    metadata: { dataVersion: "2", matchId: `EUW1_${idSuffix}`, participants: ["P1", "P2"] },
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
          championId: 1,
          championName: "Annie",
          champLevel: 16,
          champExperience: 18000,
          teamId: 100,
          teamPosition: "MIDDLE",
          individualPosition: "MIDDLE",
          lane: "MIDDLE",
          role: "SOLO",
          win: p1Win,
          kills: 5,
          deaths: 3,
          assists: 7,
          goldEarned: 13500,
          goldSpent: 13000,
          totalMinionsKilled: 180,
          neutralMinionsKilled: 12,
          visionScore: 24,
          wardsPlaced: 14,
          wardsKilled: 5,
          detectorWardsPlaced: 3,
          totalDamageDealtToChampions: 22000,
          physicalDamageDealtToChampions: 3000,
          magicDamageDealtToChampions: 18000,
          trueDamageDealtToChampions: 1000,
          totalDamageTaken: 18000,
          damageSelfMitigated: 12000,
          totalHeal: 800,
          totalHealsOnTeammates: 0,
          damageDealtToObjectives: 5000,
          damageDealtToTurrets: 3000,
          damageDealtToBuildings: 3500,
          timeCCingOthers: 22,
          totalTimeSpentDead: 90,
          longestTimeSpentLiving: 720,
          largestKillingSpree: 3,
          largestMultiKill: 2,
          killingSprees: 1,
          doubleKills: 1,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          firstBloodKill: false,
          firstBloodAssist: true,
          turretKills: 1,
          turretTakedowns: 3,
          inhibitorKills: 0,
          inhibitorTakedowns: 1,
          dragonKills: 0,
          baronKills: 0,
          objectivesStolen: 0,
          objectivesStolenAssists: 0,
          gameEndedInSurrender: false,
          gameEndedInEarlySurrender: false,
          teamEarlySurrendered: false,
          summoner1Id: 4,
          summoner2Id: 14,
          item0: 6655,
          item1: 3020,
          item2: 3157,
          item3: 4645,
          item4: 0,
          item5: 0,
          item6: 3340,
          perks: {
            statPerks: { defense: 5002, flex: 5008, offense: 5005 },
            styles: [
              {
                description: "primaryStyle",
                style: 8200,
                selections: [
                  { perk: 8214, var1: 1, var2: 2, var3: 3 },
                  { perk: 8226, var1: 0, var2: 0, var3: 0 },
                  { perk: 8210, var1: 0, var2: 0, var3: 0 },
                  { perk: 8237, var1: 0, var2: 0, var3: 0 },
                ],
              },
              {
                description: "subStyle",
                style: 8100,
                selections: [
                  { perk: 8126, var1: 0, var2: 0, var3: 0 },
                  { perk: 8135, var1: 0, var2: 0, var3: 0 },
                ],
              },
            ],
          },
          challenges: { kda: 4.0, killParticipation: 0.65, damagePerMinute: 733.3 },
          riotIdGameName: "Alice",
          riotIdTagline: "EUW",
          summonerLevel: 200,
        },
        {
          puuid: "P2",
          participantId: 6,
          championId: 2,
          championName: "Olaf",
          champLevel: 14,
          teamId: 200,
          teamPosition: "JUNGLE",
          individualPosition: "JUNGLE",
          win: !p1Win,
          kills: 8,
          deaths: 4,
          assists: 2,
          goldEarned: 12000,
          visionScore: 18,
          totalDamageDealtToChampions: 28000,
          item0: 6630,
        },
      ],
      teams: [
        { teamId: 100, win: p1Win, bans: [], objectives: {} },
        { teamId: 200, win: !p1Win, bans: [], objectives: {} },
      ],
    },
  });

insertMatch(db, fakeMatch("001", 3_600_000, true));
insertMatch(db, fakeMatch("002", 7_200_000, false));
insertMatch(db, fakeMatch("003", 86_400_000 * 5, true));

const fakeTl = MatchTimeline.parse({
  metadata: { dataVersion: "2", matchId: "EUW1_001", participants: ["P1", "P2"] },
  info: { frameInterval: 60_000, gameId: 1, participants: [], frames: [] },
});
insertMatchTimeline(db, "EUW1_001", fakeTl);

insertRankSnapshot(
  db,
  "P1",
  [
    {
      queueType: "RANKED_SOLO_5x5",
      tier: "DIAMOND",
      rank: "IV",
      leaguePoints: 42,
      wins: 60,
      losses: 55,
      hotStreak: true,
      veteran: false,
      freshBlood: false,
      inactive: false,
    },
  ],
  now,
);

upsertMastery(db, "P1", [
  {
    puuid: "P1",
    championId: 1,
    championPoints: 250000,
    championLevel: 7,
    lastPlayTime: now - 3_600_000,
    chestGranted: true,
    tokensEarned: 0,
  },
]);

setIngestMatchCursor(db, "P1", now, now - 3_600_000);
setIngestMatchCursor(db, "P2", now, now - 3_600_000);

const all = queryTimeline(db);
console.assert(all.length === 6, `expected 6 rows, got ${all.length}`);

const aliceRow = db
  .select()
  .from(matchParticipants)
  .where(eq(matchParticipants.puuid, "P1"))
  .all()
  .find((r) => r.matchId === "EUW1_001");
if (!aliceRow) throw new Error("alice participant row missing");
console.assert(aliceRow.goldEarned === 13500, "goldEarned");
console.assert(aliceRow.visionScore === 24, "visionScore");
console.assert(aliceRow.totalDamageDealtToChampions === 22000, "damage to champs");
console.assert(aliceRow.item0 === 6655, "item0");
console.assert(aliceRow.perksKeystone === 8214, "keystone");
console.assert(aliceRow.win === true, `win should be true bool, got ${typeof aliceRow.win}`);
console.assert(aliceRow.firstBloodKill === false, "firstBloodKill bool");
console.assert(
  aliceRow.challengesJson !== null && aliceRow.challengesJson.kda === 4.0,
  "challenges json round-trips",
);
console.assert(
  aliceRow.perksJson !== null && aliceRow.perksJson.styles[0]?.style === 8200,
  "perks json round-trips",
);

const tlCount = db.select().from(matchTimelines).all().length;
console.assert(tlCount === 1, `expected 1 timeline, got ${tlCount}`);

const rank = db.select().from(playerRankSnapshots).all();
console.assert(rank.length === 1 && rank[0]?.tier === "DIAMOND" && rank[0]?.leaguePoints === 42);
console.assert(rank[0]?.hotStreak === true, "hotStreak bool");

const m = db.select().from(playerMastery).all();
console.assert(m.length === 1 && m[0]?.championPoints === 250000 && m[0]?.championLevel === 7);

insertMatch(db, fakeMatch("001", 3_600_000, true));
const allAgain = queryTimeline(db);
console.assert(allAgain.length === all.length, "duplicate insert is a no-op");

db.$client.close();
const db2 = openDb(DB_PATH);
const rows = queryTimeline(db2);
console.assert(rows.length === all.length, "reopen preserves rows");

// rekey: rotate P1 → P1_NEW across every table, leave P2 alone.
const fp = keyFingerprint("RGAPI-abc-123");
setMeta(db2, KEY_FINGERPRINT_META, fp);
console.assert(getMeta(db2, KEY_FINGERPRINT_META) === fp, "meta round-trips");
console.assert(fp.length === 16, "fingerprint is 16 hex chars");

rekeyPlayerPuuid(db2, "P1", "P1_NEW");

console.assert(
  db2.select().from(players).where(eq(players.puuid, "P1")).get() === undefined,
  "old player puuid gone",
);
console.assert(
  db2.select().from(players).where(eq(players.puuid, "P1_NEW")).get() !== undefined,
  "new player puuid present",
);
console.assert(
  db2.select().from(players).where(eq(players.puuid, "P2")).get() !== undefined,
  "untouched player preserved",
);
console.assert(
  db2.select().from(matchParticipants).where(eq(matchParticipants.puuid, "P1")).all()
    .length === 0,
  "match_participants moved off old puuid",
);
console.assert(
  db2.select().from(matchParticipants).where(eq(matchParticipants.puuid, "P1_NEW"))
    .all().length > 0,
  "match_participants moved to new puuid",
);
console.assert(
  db2.select().from(playerRankSnapshots).where(eq(playerRankSnapshots.puuid, "P1_NEW"))
    .all().length === 1,
  "rank snapshot moved",
);
console.assert(
  db2.select().from(playerMastery).where(eq(playerMastery.puuid, "P1_NEW")).all()
    .length === 1,
  "mastery moved",
);
console.assert(
  db2.select().from(ingestState).where(eq(ingestState.puuid, "P1_NEW")).get() !==
    undefined,
  "ingest_state moved",
);

// re-running with same old/new should be a no-op (and not throw)
rekeyPlayerPuuid(db2, "P1_NEW", "P1_NEW");

// rewrite raw_json blobs: matches.metadata.participants and info.participants[].puuid
const before = db2
  .select({ rawJson: matches.rawJson })
  .from(matches)
  .where(eq(matches.matchId, "EUW1_001"))
  .get();
console.assert(
  before?.rawJson.metadata.participants.includes("P1"),
  "pre-rewrite: raw_json still references P1",
);

const r = rewriteRawJsonPuuids(db2, new Map([["P1", "P1_NEW"]]));
console.assert(r.matchesUpdated === 3, `expected 3 matches rewritten, got ${r.matchesUpdated}`);
console.assert(r.timelinesUpdated === 1, `expected 1 timeline rewritten, got ${r.timelinesUpdated}`);

const after = db2
  .select({ rawJson: matches.rawJson })
  .from(matches)
  .where(eq(matches.matchId, "EUW1_001"))
  .get();
console.assert(
  !after?.rawJson.metadata.participants.includes("P1"),
  "post-rewrite: raw_json no longer references P1",
);
console.assert(
  after?.rawJson.metadata.participants.includes("P1_NEW"),
  "post-rewrite: raw_json now references P1_NEW",
);
console.assert(
  after?.rawJson.info.participants[0]?.puuid === "P1_NEW",
  "post-rewrite: participant puuid updated",
);
console.assert(
  after?.rawJson.info.participants[1]?.puuid === "P2",
  "post-rewrite: untouched participant preserved",
);

const tlAfter = db2
  .select({ rawJson: matchTimelines.rawJson })
  .from(matchTimelines)
  .where(eq(matchTimelines.matchId, "EUW1_001"))
  .get();
console.assert(
  tlAfter?.rawJson.metadata.participants.includes("P1_NEW"),
  "post-rewrite: timeline metadata updated",
);

// idempotent: re-running with same mapping should be a no-op (no rows updated)
const r2 = rewriteRawJsonPuuids(db2, new Map([["P1", "P1_NEW"]]));
console.assert(
  r2.matchesUpdated === 0 && r2.timelinesUpdated === 0,
  "second rewrite is a no-op",
);

db2.$client.close();

console.log("smoke ok — drizzle schema, zod-parsed matches, projected columns, all round-trip");
