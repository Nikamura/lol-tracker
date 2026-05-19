import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "./connect.js";
import { notRemakeCond } from "./match-filters.js";
import {
  matchParticipants,
  matches,
  playerMastery,
  playerRankSnapshots,
  players,
  type Player,
  type PlayerMasteryRow,
} from "./schema.js";

const SOLO_QUEUE = "RANKED_SOLO_5x5";
const FLEX_QUEUE = "RANKED_FLEX_SR";

/**
 * Tier rank table used to make `tier + division + LP` sortable / chartable
 * as a single scalar. Apex tiers (master+) have no division, so we leave the
 * division offset at 0 there.
 */
const TIER_RANK: Record<string, number> = {
  IRON: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  EMERALD: 5,
  DIAMOND: 6,
  MASTER: 7,
  GRANDMASTER: 8,
  CHALLENGER: 9,
};

const DIVISION_OFFSET: Record<string, number> = {
  I: 300,
  II: 200,
  III: 100,
  IV: 0,
};

const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/**
 * Project a `(tier, rank, leaguePoints)` triple into a single scalar so that
 * sparkline points compare correctly across promotions/demotions.
 *
 *   tier_rank * 1000 + division_offset + leaguePoints
 *
 * For master+, division is irrelevant; we use just `tier_rank * 1000 + LP`.
 */
export function rankToScalar(
  tier: string | null,
  division: string | null,
  leaguePoints: number | null,
): number | null {
  if (!tier) return null;
  const tierRank = TIER_RANK[tier];
  if (tierRank === undefined) return null;
  const lp = leaguePoints ?? 0;
  if (APEX_TIERS.has(tier)) return tierRank * 1000 + lp;
  const divOff = division ? DIVISION_OFFSET[division] ?? 0 : 0;
  return tierRank * 1000 + divOff + lp;
}

export interface ProfileHeadline {
  games: number;
  wins: number;
  losses: number;
  winrate: number; // 0..1
  avgKda: number;
  csPerMin: number;
  goldPerMin: number;
  visionPerGame: number;
  dmgToChampsPerMin: number;
}

export interface RankSnapshotPoint {
  capturedAt: number;
  tier: string;
  division: string | null;
  leaguePoints: number;
  scalar: number;
}

export interface RoleStat {
  position: string;
  games: number;
  wins: number;
  winrate: number;
}

export interface ChampionStat {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winrate: number;
  avgKda: number;
}

export interface MasteryStat {
  championId: number;
  championPoints: number;
  championLevel: number;
  lastPlayTime: number | null;
}

export interface ProfileRecentMatch {
  matchId: string;
  gameStart: number;
  gameDuration: number;
  gameVersion: string;
  queueId: number;
  gameMode: string;
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

export interface CurrentRank {
  queueType: string;
  tier: string;
  division: string | null;
  leaguePoints: number;
  wins: number;
  losses: number;
  capturedAt: number;
}

export interface ProfileData {
  player: Player;
  currentSoloRank: CurrentRank | undefined;
  latestGameVersion: string | undefined;
  headline: ProfileHeadline;
  rankHistorySolo: RankSnapshotPoint[];
  rankHistoryFlex: RankSnapshotPoint[];
  roleStats: RoleStat[];
  championStats: ChampionStat[];
  masteryTop: MasteryStat[];
  recentMatches: ProfileRecentMatch[];
}

export interface ProfileQueryOpts {
  sinceMs?: number | undefined;
  queueIds?: number[] | undefined;
}

function getCurrentSoloRank(db: DB, puuid: string): CurrentRank | undefined {
  const row = db
    .select({
      queueType: playerRankSnapshots.queueType,
      tier: playerRankSnapshots.tier,
      rank: playerRankSnapshots.rank,
      leaguePoints: playerRankSnapshots.leaguePoints,
      wins: playerRankSnapshots.wins,
      losses: playerRankSnapshots.losses,
      capturedAt: playerRankSnapshots.capturedAt,
    })
    .from(playerRankSnapshots)
    .where(
      and(
        eq(playerRankSnapshots.puuid, puuid),
        eq(playerRankSnapshots.queueType, SOLO_QUEUE),
      ),
    )
    .orderBy(desc(playerRankSnapshots.capturedAt))
    .limit(1)
    .get();
  if (!row || !row.tier) return undefined;
  return {
    queueType: row.queueType,
    tier: row.tier,
    division: row.rank,
    leaguePoints: row.leaguePoints ?? 0,
    wins: row.wins,
    losses: row.losses,
    capturedAt: row.capturedAt,
  };
}

function getRankHistory(
  db: DB,
  puuid: string,
  queueType: string,
): RankSnapshotPoint[] {
  const rows = db
    .select({
      capturedAt: playerRankSnapshots.capturedAt,
      tier: playerRankSnapshots.tier,
      rank: playerRankSnapshots.rank,
      leaguePoints: playerRankSnapshots.leaguePoints,
    })
    .from(playerRankSnapshots)
    .where(
      and(
        eq(playerRankSnapshots.puuid, puuid),
        eq(playerRankSnapshots.queueType, queueType),
      ),
    )
    .orderBy(asc(playerRankSnapshots.capturedAt))
    .all();
  const out: RankSnapshotPoint[] = [];
  for (const r of rows) {
    if (!r.tier) continue;
    const scalar = rankToScalar(r.tier, r.rank, r.leaguePoints);
    if (scalar == null) continue;
    out.push({
      capturedAt: r.capturedAt,
      tier: r.tier,
      division: r.rank,
      leaguePoints: r.leaguePoints ?? 0,
      scalar,
    });
  }
  return out;
}

function getHeadline(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts,
): ProfileHeadline {
  const conds = [eq(matchParticipants.puuid, puuid), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const row = db
    .select({
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} THEN 1 ELSE 0 END)`,
      totalKills: sql<number>`COALESCE(SUM(${matchParticipants.kills}), 0)`,
      totalDeaths: sql<number>`COALESCE(SUM(${matchParticipants.deaths}), 0)`,
      totalAssists: sql<number>`COALESCE(SUM(${matchParticipants.assists}), 0)`,
      totalCs: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.totalMinionsKilled}, 0) + COALESCE(${matchParticipants.neutralMinionsKilled}, 0)), 0)`,
      totalGold: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.goldEarned}, 0)), 0)`,
      totalVision: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.visionScore}, 0)), 0)`,
      totalDmgChamps: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.totalDamageDealtToChampions}, 0)), 0)`,
      totalDurationSec: sql<number>`COALESCE(SUM(${matches.gameDuration}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .get();

  const games = row?.games ?? 0;
  const wins = row?.wins ?? 0;
  const losses = Math.max(0, games - wins);
  const winrate = games > 0 ? wins / games : 0;
  const totalDeaths = row?.totalDeaths ?? 0;
  const totalKills = row?.totalKills ?? 0;
  const totalAssists = row?.totalAssists ?? 0;
  const avgKda =
    totalDeaths > 0 ? (totalKills + totalAssists) / totalDeaths : totalKills + totalAssists;
  const durationMin = (row?.totalDurationSec ?? 0) / 60;
  const csPerMin = durationMin > 0 ? (row?.totalCs ?? 0) / durationMin : 0;
  const goldPerMin = durationMin > 0 ? (row?.totalGold ?? 0) / durationMin : 0;
  const dmgToChampsPerMin = durationMin > 0 ? (row?.totalDmgChamps ?? 0) / durationMin : 0;
  const visionPerGame = games > 0 ? (row?.totalVision ?? 0) / games : 0;

  return {
    games,
    wins,
    losses,
    winrate,
    avgKda,
    csPerMin,
    goldPerMin,
    visionPerGame,
    dmgToChampsPerMin,
  };
}

function getRoleStats(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts,
): RoleStat[] {
  const conds = [eq(matchParticipants.puuid, puuid), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const rows = db
    .select({
      position: matchParticipants.teamPosition,
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} THEN 1 ELSE 0 END)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.teamPosition)
    .all();

  return rows
    .filter((r) => r.position != null && r.position !== "")
    .map((r) => {
      const games = r.games ?? 0;
      const wins = r.wins ?? 0;
      return {
        position: r.position as string,
        games,
        wins,
        winrate: games > 0 ? wins / games : 0,
      };
    });
}

function getChampionStats(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts,
  limit: number,
): ChampionStat[] {
  const conds = [eq(matchParticipants.puuid, puuid), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const rows = db
    .select({
      championId: matchParticipants.championId,
      championName: matchParticipants.championName,
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} THEN 1 ELSE 0 END)`,
      totalKills: sql<number>`COALESCE(SUM(${matchParticipants.kills}), 0)`,
      totalDeaths: sql<number>`COALESCE(SUM(${matchParticipants.deaths}), 0)`,
      totalAssists: sql<number>`COALESCE(SUM(${matchParticipants.assists}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.championId, matchParticipants.championName)
    .orderBy(desc(sql<number>`COUNT(*)`))
    .limit(limit)
    .all();

  return rows.map((r) => {
    const games = r.games ?? 0;
    const wins = r.wins ?? 0;
    const totalDeaths = r.totalDeaths ?? 0;
    const totalKills = r.totalKills ?? 0;
    const totalAssists = r.totalAssists ?? 0;
    const avgKda =
      totalDeaths > 0
        ? (totalKills + totalAssists) / totalDeaths
        : totalKills + totalAssists;
    return {
      championId: r.championId,
      championName: r.championName,
      games,
      wins,
      winrate: games > 0 ? wins / games : 0,
      avgKda,
    };
  });
}

function getMasteryTop(db: DB, puuid: string, limit: number): MasteryStat[] {
  const rows: PlayerMasteryRow[] = db
    .select()
    .from(playerMastery)
    .where(eq(playerMastery.puuid, puuid))
    .orderBy(desc(playerMastery.championPoints))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    championId: r.championId,
    championPoints: r.championPoints,
    championLevel: r.championLevel,
    lastPlayTime: r.lastPlayTime,
  }));
}

function getRecentMatches(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts,
  limit: number,
): ProfileRecentMatch[] {
  const conds = [eq(matchParticipants.puuid, puuid), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  return db
    .select({
      matchId: matches.matchId,
      gameStart: matches.gameStart,
      gameDuration: matches.gameDuration,
      gameVersion: matches.gameVersion,
      queueId: matches.queueId,
      gameMode: matches.gameMode,
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
    .where(and(...conds))
    .orderBy(desc(matches.gameStart))
    .limit(limit)
    .all();
}

function getLatestGameVersion(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts,
): string | undefined {
  const conds = [eq(matchParticipants.puuid, puuid), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const row = db
    .select({ gameVersion: matches.gameVersion })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .orderBy(desc(matches.gameStart))
    .limit(1)
    .get();

  if (row?.gameVersion) return row.gameVersion;

  // Fall back to absolute newest across all of this player's matches so the
  // header still picks a sensible icon CDN version even when filters are
  // narrow / empty.
  const fallback = db
    .select({ gameVersion: matches.gameVersion })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(eq(matchParticipants.puuid, puuid), notRemakeCond()))
    .orderBy(desc(matches.gameStart))
    .limit(1)
    .get();

  return fallback?.gameVersion;
}

export function getProfileData(
  db: DB,
  puuid: string,
  opts: ProfileQueryOpts = {},
): ProfileData | undefined {
  const player = db.select().from(players).where(eq(players.puuid, puuid)).get();
  if (!player) return undefined;

  const headline = getHeadline(db, puuid, opts);
  const rankHistorySolo = getRankHistory(db, puuid, SOLO_QUEUE);
  const rankHistoryFlex = getRankHistory(db, puuid, FLEX_QUEUE);
  const roleStats = getRoleStats(db, puuid, opts).sort((a, b) => b.games - a.games);
  const championStats = getChampionStats(db, puuid, opts, 10);
  const masteryTop = getMasteryTop(db, puuid, 10);
  const recentMatches = getRecentMatches(db, puuid, opts, 10);
  const currentSoloRank = getCurrentSoloRank(db, puuid);
  const latestGameVersion = getLatestGameVersion(db, puuid, opts);

  return {
    player,
    currentSoloRank,
    latestGameVersion,
    headline,
    rankHistorySolo,
    rankHistoryFlex,
    roleStats,
    championStats,
    masteryTop,
    recentMatches,
  };
}

