import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
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

export interface DeletePlayerResult {
  player: Player;
  orphanedMatches: number;
}

export function findPlayerByRiotId(
  db: DB,
  gameName: string,
  tagLine: string,
): Player | undefined {
  return db
    .select()
    .from(players)
    .where(and(eq(players.gameName, gameName), eq(players.tagLine, tagLine)))
    .get();
}

export function findPlayersByGameName(db: DB, gameName: string): Player[] {
  return db.select().from(players).where(eq(players.gameName, gameName)).all();
}

export function deletePlayer(
  db: DB,
  puuid: string,
  options: { purgeOrphanMatches: boolean },
): number {
  return db.transaction((tx) => {
    tx.delete(players).where(eq(players.puuid, puuid)).run();
    if (!options.purgeOrphanMatches) return 0;
    const orphans = tx
      .select({ matchId: matches.matchId })
      .from(matches)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${matchParticipants} mp INNER JOIN ${players} pl ON pl.puuid = mp.puuid WHERE mp.match_id = ${matches.matchId})`,
      )
      .all();
    if (orphans.length === 0) return 0;
    tx.delete(matches)
      .where(inArray(matches.matchId, orphans.map((o) => o.matchId)))
      .run();
    return orphans.length;
  });
}

export function listPlayers(db: DB): Player[] {
  return db
    .select()
    .from(players)
    .orderBy(asc(players.displayName), asc(players.gameName))
    .all();
}

export function lastPlayedByPuuid(db: DB): Map<string, number> {
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      lastPlayed: sql<number>`MAX(${matches.gameStart})`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .groupBy(matchParticipants.puuid)
    .all();
  return new Map(rows.map((r) => [r.puuid, r.lastPlayed]));
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
  gameVersion: string;
  queueId: number;
  gameMode: string;
  puuid: string;
  displayName: string | null;
  gameName: string;
  championName: string;
  champLevel: number | null;
  teamPosition: string | null;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number | null;
  neutralMinionsKilled: number | null;
  goldEarned: number | null;
  visionScore: number | null;
  summoner1Id: number | null;
  summoner2Id: number | null;
  perksPrimaryStyle: number | null;
  perksSubStyle: number | null;
  perksKeystone: number | null;
  item0: number | null;
  item1: number | null;
  item2: number | null;
  item3: number | null;
  item4: number | null;
  item5: number | null;
  item6: number | null;
  doubleKills: number | null;
  tripleKills: number | null;
  quadraKills: number | null;
  pentaKills: number | null;
  firstBloodKill: boolean | null;
  gameEndedInSurrender: boolean | null;
  teamEarlySurrendered: boolean | null;
}

export interface TimelineFilter {
  sinceMs?: number;
  puuids?: string[];
  queueIds?: number[];
  limit?: number;
}

export interface PartyRow {
  matchId: string;
  teamId: number;
  gameStart: number;
  gameDuration: number;
  queueId: number;
  gameMode: string;
  win: boolean;
  members: TimelineRow[];
}

export function queryParties(db: DB, f: TimelineFilter = {}): PartyRow[] {
  const rows = queryTimeline(db, { ...f, limit: 1_000 });

  const grouped = new Map<string, PartyRow>();
  for (const r of rows) {
    const key = `${r.matchId}|${r.teamId}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        matchId: r.matchId,
        teamId: r.teamId,
        gameStart: r.gameStart,
        gameDuration: r.gameDuration,
        queueId: r.queueId,
        gameMode: r.gameMode,
        win: r.win,
        members: [],
      };
      grouped.set(key, entry);
    }
    entry.members.push(r);
  }

  return [...grouped.values()]
    .sort((a, b) => b.gameStart - a.gameStart)
    .slice(0, f.limit ?? 50);
}

export interface MatchDetailParticipant {
  puuid: string;
  teamId: number;
  championName: string;
  teamPosition: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number | null;
  totalMinionsKilled: number | null;
  neutralMinionsKilled: number | null;
  visionScore: number | null;
  totalDamageDealtToChampions: number | null;
  totalDamageTaken: number | null;
  damageDealtToObjectives: number | null;
  champLevel: number | null;
  item0: number | null;
  item1: number | null;
  item2: number | null;
  item3: number | null;
  item4: number | null;
  item5: number | null;
  item6: number | null;
  riotIdGameName: string | null;
  riotIdTagline: string | null;
  trackedDisplayName: string | null;
}

export interface MatchDetail {
  matchId: string;
  gameStart: number;
  gameDuration: number;
  queueId: number;
  gameMode: string;
  participants: MatchDetailParticipant[];
}

export interface RankInfo {
  queueType: string;
  tier: string | null;
  rank: string | null;
  leaguePoints: number | null;
}

export interface MatchRaw {
  match: Match;
  timeline: MatchTimeline | undefined;
  trackedNames: Map<string, string>;
  trackedRanks: Map<string, RankInfo>;
}

const SOLO_QUEUE = "RANKED_SOLO_5x5";

export function latestRanksBefore(
  db: DB,
  puuids: string[],
  beforeMs: number,
): Map<string, RankInfo> {
  const out = new Map<string, RankInfo>();
  if (puuids.length === 0) return out;
  for (const puuid of puuids) {
    const before = db
      .select({
        queueType: playerRankSnapshots.queueType,
        tier: playerRankSnapshots.tier,
        rank: playerRankSnapshots.rank,
        leaguePoints: playerRankSnapshots.leaguePoints,
      })
      .from(playerRankSnapshots)
      .where(
        and(
          eq(playerRankSnapshots.puuid, puuid),
          eq(playerRankSnapshots.queueType, SOLO_QUEUE),
          lte(playerRankSnapshots.capturedAt, beforeMs),
        ),
      )
      .orderBy(desc(playerRankSnapshots.capturedAt))
      .limit(1)
      .get();
    const row =
      before ??
      db
        .select({
          queueType: playerRankSnapshots.queueType,
          tier: playerRankSnapshots.tier,
          rank: playerRankSnapshots.rank,
          leaguePoints: playerRankSnapshots.leaguePoints,
        })
        .from(playerRankSnapshots)
        .where(
          and(
            eq(playerRankSnapshots.puuid, puuid),
            eq(playerRankSnapshots.queueType, SOLO_QUEUE),
          ),
        )
        .orderBy(asc(playerRankSnapshots.capturedAt))
        .limit(1)
        .get();
    if (row && row.tier) {
      out.set(puuid, {
        queueType: row.queueType,
        tier: row.tier,
        rank: row.rank,
        leaguePoints: row.leaguePoints,
      });
    }
  }
  return out;
}

export function getMatchRaw(db: DB, matchId: string): MatchRaw | undefined {
  const head = db.select().from(matches).where(eq(matches.matchId, matchId)).get();
  if (!head) return undefined;
  const tl = db
    .select({ rawJson: matchTimelines.rawJson })
    .from(matchTimelines)
    .where(eq(matchTimelines.matchId, matchId))
    .get();
  const tracked = db
    .select({
      puuid: matchParticipants.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
    })
    .from(matchParticipants)
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .where(eq(matchParticipants.matchId, matchId))
    .all();
  const trackedPuuids = tracked.map((t) => t.puuid);
  return {
    match: head.rawJson,
    timeline: tl?.rawJson,
    trackedNames: new Map(tracked.map((t) => [t.puuid, t.displayName ?? t.gameName])),
    trackedRanks: latestRanksBefore(db, trackedPuuids, head.gameStart),
  };
}

export function queryMatchDetail(db: DB, matchId: string): MatchDetail | undefined {
  const head = db.select().from(matches).where(eq(matches.matchId, matchId)).get();
  if (!head) return undefined;

  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      teamId: matchParticipants.teamId,
      championName: matchParticipants.championName,
      teamPosition: matchParticipants.teamPosition,
      win: matchParticipants.win,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
      goldEarned: matchParticipants.goldEarned,
      totalMinionsKilled: matchParticipants.totalMinionsKilled,
      neutralMinionsKilled: matchParticipants.neutralMinionsKilled,
      visionScore: matchParticipants.visionScore,
      totalDamageDealtToChampions: matchParticipants.totalDamageDealtToChampions,
      totalDamageTaken: matchParticipants.totalDamageTaken,
      damageDealtToObjectives: matchParticipants.damageDealtToObjectives,
      champLevel: matchParticipants.champLevel,
      item0: matchParticipants.item0,
      item1: matchParticipants.item1,
      item2: matchParticipants.item2,
      item3: matchParticipants.item3,
      item4: matchParticipants.item4,
      item5: matchParticipants.item5,
      item6: matchParticipants.item6,
      riotIdGameName: matchParticipants.riotIdGameName,
      riotIdTagline: matchParticipants.riotIdTagline,
      trackedDisplayName: players.displayName,
    })
    .from(matchParticipants)
    .leftJoin(players, eq(players.puuid, matchParticipants.puuid))
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(asc(matchParticipants.teamId))
    .all();

  return {
    matchId: head.matchId,
    gameStart: head.gameStart,
    gameDuration: head.gameDuration,
    queueId: head.queueId,
    gameMode: head.gameMode,
    participants: rows,
  };
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
      gameVersion: matches.gameVersion,
      queueId: matches.queueId,
      gameMode: matches.gameMode,
      puuid: matchParticipants.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
      championName: matchParticipants.championName,
      champLevel: matchParticipants.champLevel,
      teamPosition: matchParticipants.teamPosition,
      teamId: matchParticipants.teamId,
      win: matchParticipants.win,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
      totalMinionsKilled: matchParticipants.totalMinionsKilled,
      neutralMinionsKilled: matchParticipants.neutralMinionsKilled,
      goldEarned: matchParticipants.goldEarned,
      visionScore: matchParticipants.visionScore,
      summoner1Id: matchParticipants.summoner1Id,
      summoner2Id: matchParticipants.summoner2Id,
      perksPrimaryStyle: matchParticipants.perksPrimaryStyle,
      perksSubStyle: matchParticipants.perksSubStyle,
      perksKeystone: matchParticipants.perksKeystone,
      item0: matchParticipants.item0,
      item1: matchParticipants.item1,
      item2: matchParticipants.item2,
      item3: matchParticipants.item3,
      item4: matchParticipants.item4,
      item5: matchParticipants.item5,
      item6: matchParticipants.item6,
      doubleKills: matchParticipants.doubleKills,
      tripleKills: matchParticipants.tripleKills,
      quadraKills: matchParticipants.quadraKills,
      pentaKills: matchParticipants.pentaKills,
      firstBloodKill: matchParticipants.firstBloodKill,
      gameEndedInSurrender: matchParticipants.gameEndedInSurrender,
      teamEarlySurrendered: matchParticipants.teamEarlySurrendered,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .orderBy(desc(matches.gameStart), asc(players.displayName))
    .limit(f.limit ?? 100);

  return conds.length ? q.where(and(...conds)).all() : q.all();
}
