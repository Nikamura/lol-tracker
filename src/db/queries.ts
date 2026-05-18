import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Platform, Region } from "../config.js";
import type {
  ChampionMastery,
  LeagueEntry,
  Match,
  MatchTimeline,
} from "../riot/types.js";
import type { DB } from "./connect.js";
import {
  ingestState,
  matchParticipants,
  matchTimelines,
  matches,
  playerMastery,
  playerRankSnapshots,
  players,
  type IngestStateRow,
  type NewMatchParticipantRow,
  type NewMatchRow,
  type NewPlayer,
  type Player,
} from "./schema.js";

export type {
  IngestStateRow,
  MatchParticipantRow,
  MatchRow,
  MatchTimelineRow,
  Player,
  PlayerMasteryRow,
  PlayerRankSnapshotRow,
} from "./schema.js";

export function upsertPlayer(
  db: DB,
  p: Omit<NewPlayer, "addedAt" | "platform" | "region"> & {
    platform: Platform;
    region: Region;
    addedAt?: number;
  },
): void {
  const row: NewPlayer = { ...p, addedAt: p.addedAt ?? Date.now() };
  db.insert(players)
    .values(row)
    .onConflictDoUpdate({
      target: players.puuid,
      set: {
        gameName: row.gameName,
        tagLine: row.tagLine,
        platform: row.platform,
        region: row.region,
        displayName: row.displayName,
      },
    })
    .run();
}

export function listPlayers(db: DB): Player[] {
  return db
    .select()
    .from(players)
    .orderBy(asc(players.displayName), asc(players.gameName))
    .all();
}

export function getIngestState(db: DB, puuid: string): IngestStateRow | undefined {
  return db.select().from(ingestState).where(eq(ingestState.puuid, puuid)).get();
}

export function setIngestMatchCursor(
  db: DB,
  puuid: string,
  lastPolledAt: number,
  lastMatchStart: number | null,
): void {
  db.insert(ingestState)
    .values({ puuid, lastPolledAt, lastMatchStart })
    .onConflictDoUpdate({
      target: ingestState.puuid,
      set: { lastPolledAt, lastMatchStart },
    })
    .run();
}

export function setIngestRankAt(db: DB, puuid: string, at: number): void {
  db.insert(ingestState)
    .values({ puuid, lastRankAt: at })
    .onConflictDoUpdate({ target: ingestState.puuid, set: { lastRankAt: at } })
    .run();
}

export function setIngestMasteryAt(db: DB, puuid: string, at: number): void {
  db.insert(ingestState)
    .values({ puuid, lastMasteryAt: at })
    .onConflictDoUpdate({ target: ingestState.puuid, set: { lastMasteryAt: at } })
    .run();
}

export function matchExists(db: DB, matchId: string): boolean {
  return (
    db
      .select({ id: matches.matchId })
      .from(matches)
      .where(eq(matches.matchId, matchId))
      .get() !== undefined
  );
}

export function timelineExists(db: DB, matchId: string): boolean {
  return (
    db
      .select({ id: matchTimelines.matchId })
      .from(matchTimelines)
      .where(eq(matchTimelines.matchId, matchId))
      .get() !== undefined
  );
}

export function insertMatch(db: DB, match: Match): void {
  const matchRow: NewMatchRow = {
    matchId: match.metadata.matchId,
    gameCreation: match.info.gameCreation,
    gameStart: match.info.gameStartTimestamp,
    gameEnd: match.info.gameEndTimestamp,
    gameDuration: match.info.gameDuration,
    gameMode: match.info.gameMode,
    gameType: match.info.gameType,
    queueId: match.info.queueId,
    gameVersion: match.info.gameVersion,
    mapId: match.info.mapId,
    platformId: match.info.platformId,
    rawJson: match,
    fetchedAt: Date.now(),
  };

  const participantRows: NewMatchParticipantRow[] = match.info.participants.map((p) => {
    const primary = p.perks?.styles.find((s) => s.description === "primaryStyle");
    const sub = p.perks?.styles.find((s) => s.description === "subStyle");
    return {
      matchId: match.metadata.matchId,
      puuid: p.puuid,
      championId: p.championId,
      championName: p.championName,
      teamId: p.teamId,
      teamPosition: p.teamPosition || p.individualPosition,
      individualPosition: p.individualPosition,
      lane: p.lane,
      role: p.role,
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      champLevel: p.champLevel,
      champExperience: p.champExperience,
      championTransform: p.championTransform,
      goldEarned: p.goldEarned,
      goldSpent: p.goldSpent,
      totalMinionsKilled: p.totalMinionsKilled,
      neutralMinionsKilled: p.neutralMinionsKilled,
      visionScore: p.visionScore,
      wardsPlaced: p.wardsPlaced,
      wardsKilled: p.wardsKilled,
      detectorWardsPlaced: p.detectorWardsPlaced,
      visionWardsBought: p.visionWardsBoughtInGame,
      totalDamageDealt: p.totalDamageDealt,
      totalDamageDealtToChampions: p.totalDamageDealtToChampions,
      physicalDamageToChampions: p.physicalDamageDealtToChampions,
      magicDamageToChampions: p.magicDamageDealtToChampions,
      trueDamageToChampions: p.trueDamageDealtToChampions,
      totalDamageTaken: p.totalDamageTaken,
      damageSelfMitigated: p.damageSelfMitigated,
      totalHeal: p.totalHeal,
      totalHealsOnTeammates: p.totalHealsOnTeammates,
      damageDealtToObjectives: p.damageDealtToObjectives,
      damageDealtToTurrets: p.damageDealtToTurrets,
      damageDealtToBuildings: p.damageDealtToBuildings,
      timeCcingOthers: p.timeCCingOthers,
      totalTimeCcDealt: p.totalTimeCCDealt,
      totalTimeSpentDead: p.totalTimeSpentDead,
      longestTimeSpentLiving: p.longestTimeSpentLiving,
      largestKillingSpree: p.largestKillingSpree,
      largestMultiKill: p.largestMultiKill,
      killingSprees: p.killingSprees,
      doubleKills: p.doubleKills,
      tripleKills: p.tripleKills,
      quadraKills: p.quadraKills,
      pentaKills: p.pentaKills,
      firstBloodKill: p.firstBloodKill,
      firstBloodAssist: p.firstBloodAssist,
      firstTowerKill: p.firstTowerKill,
      firstTowerAssist: p.firstTowerAssist,
      turretKills: p.turretKills,
      turretTakedowns: p.turretTakedowns,
      inhibitorKills: p.inhibitorKills,
      inhibitorTakedowns: p.inhibitorTakedowns,
      dragonKills: p.dragonKills,
      baronKills: p.baronKills,
      objectivesStolen: p.objectivesStolen,
      objectivesStolenAssists: p.objectivesStolenAssists,
      gameEndedInSurrender: p.gameEndedInSurrender,
      gameEndedInEarlySurrender: p.gameEndedInEarlySurrender,
      teamEarlySurrendered: p.teamEarlySurrendered,
      summoner1Id: p.summoner1Id,
      summoner2Id: p.summoner2Id,
      summoner1Casts: p.summoner1Casts,
      summoner2Casts: p.summoner2Casts,
      item0: p.item0,
      item1: p.item1,
      item2: p.item2,
      item3: p.item3,
      item4: p.item4,
      item5: p.item5,
      item6: p.item6,
      perksPrimaryStyle: primary?.style,
      perksSubStyle: sub?.style,
      perksKeystone: primary?.selections[0]?.perk,
      perksJson: p.perks,
      challengesJson: p.challenges,
      riotIdGameName: p.riotIdGameName,
      riotIdTagline: p.riotIdTagline,
      summonerName: p.summonerName,
      summonerLevel: p.summonerLevel,
    };
  });

  db.transaction((tx) => {
    tx.insert(matches).values(matchRow).onConflictDoNothing().run();
    if (participantRows.length > 0) {
      tx.insert(matchParticipants).values(participantRows).onConflictDoNothing().run();
    }
  });
}

export function insertMatchTimeline(db: DB, matchId: string, timeline: MatchTimeline): void {
  const fetchedAt = Date.now();
  db.insert(matchTimelines)
    .values({ matchId, rawJson: timeline, fetchedAt })
    .onConflictDoUpdate({
      target: matchTimelines.matchId,
      set: { rawJson: timeline, fetchedAt },
    })
    .run();
}

export function insertRankSnapshot(
  db: DB,
  puuid: string,
  entries: LeagueEntry[],
  capturedAt: number,
): void {
  if (entries.length === 0) return;
  db.insert(playerRankSnapshots)
    .values(
      entries.map((e) => ({
        puuid,
        queueType: e.queueType,
        tier: e.tier,
        rank: e.rank,
        leaguePoints: e.leaguePoints,
        wins: e.wins,
        losses: e.losses,
        hotStreak: e.hotStreak,
        veteran: e.veteran,
        freshBlood: e.freshBlood,
        inactive: e.inactive,
        capturedAt,
        rawJson: e,
      })),
    )
    .run();
}

export function upsertMastery(db: DB, puuid: string, masteries: ChampionMastery[]): void {
  if (masteries.length === 0) return;
  const fetchedAt = Date.now();
  db.insert(playerMastery)
    .values(
      masteries.map((m) => ({
        puuid,
        championId: m.championId,
        championPoints: m.championPoints,
        championLevel: m.championLevel,
        lastPlayTime: m.lastPlayTime,
        chestGranted: m.chestGranted,
        tokensEarned: m.tokensEarned,
        fetchedAt,
        rawJson: m,
      })),
    )
    .onConflictDoUpdate({
      target: [playerMastery.puuid, playerMastery.championId],
      set: {
        championPoints: sql`excluded.champion_points`,
        championLevel: sql`excluded.champion_level`,
        lastPlayTime: sql`excluded.last_play_time`,
        chestGranted: sql`excluded.chest_granted`,
        tokensEarned: sql`excluded.tokens_earned`,
        fetchedAt: sql`excluded.fetched_at`,
        rawJson: sql`excluded.raw_json`,
      },
    })
    .run();
}

export interface TimelineRow {
  matchId: string;
  gameStart: number;
  gameDuration: number;
  queueId: number;
  gameMode: string;
  puuid: string;
  displayName: string | null;
  gameName: string;
  championName: string;
  teamPosition: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

export interface TimelineFilter {
  sinceMs?: number;
  puuids?: string[];
  queueIds?: number[];
  limit?: number;
}

export function queryTimeline(db: DB, f: TimelineFilter = {}): TimelineRow[] {
  const conds: SQL[] = [];
  if (f.sinceMs !== undefined) conds.push(gte(matches.gameStart, f.sinceMs));
  if (f.puuids?.length) conds.push(inArray(matchParticipants.puuid, f.puuids));
  if (f.queueIds?.length) conds.push(inArray(matches.queueId, f.queueIds));

  const q = db
    .select({
      matchId: matches.matchId,
      gameStart: matches.gameStart,
      gameDuration: matches.gameDuration,
      queueId: matches.queueId,
      gameMode: matches.gameMode,
      puuid: matchParticipants.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
      championName: matchParticipants.championName,
      teamPosition: matchParticipants.teamPosition,
      win: matchParticipants.win,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .orderBy(desc(matches.gameStart), asc(players.displayName))
    .limit(f.limit ?? 100);

  return conds.length ? q.where(and(...conds)).all() : q.all();
}
