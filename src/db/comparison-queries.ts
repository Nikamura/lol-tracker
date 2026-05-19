import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "./connect.js";
import { notRemakeCond } from "./match-filters.js";
import {
  matchParticipants,
  matches,
  playerRankSnapshots,
  players,
} from "./schema.js";
import { rankToScalar } from "./profile-queries.js";

const SOLO_QUEUE = "RANKED_SOLO_5x5";
const FLEX_QUEUE = "RANKED_FLEX_SR";

export interface ComparisonOptions {
  sinceMs?: number | undefined;
  queueIds?: number[] | undefined;
  excludedPuuids?: string[] | undefined;
}

export interface PlayerLite {
  puuid: string;
  displayName: string;
}

function readPlayers(db: DB, excludedPuuids?: string[]): PlayerLite[] {
  const excluded = excludedPuuids?.length ? new Set(excludedPuuids) : null;
  const rows = db
    .select({
      puuid: players.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
    })
    .from(players)
    .all()
    .map((p) => ({
      puuid: p.puuid,
      displayName: p.displayName ?? p.gameName,
    }));
  return excluded ? rows.filter((p) => !excluded.has(p.puuid)) : rows;
}

/** Full unfiltered roster — used by the page UI to render exclusion toggles. */
export function listComparePlayers(db: DB): PlayerLite[] {
  return readPlayers(db);
}

function commonConds(opts: ComparisonOptions) {
  const conds = [notRemakeCond()] as ReturnType<typeof eq>[];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));
  return conds;
}

// ---------------------------------------------------------------------------
// 1. The Roaring Rank Race — LP-over-time per player
// ---------------------------------------------------------------------------

export interface RankRacePoint {
  t: number;
  lp: number;
}

export interface RankRaceSeries {
  puuid: string;
  displayName: string;
  points: RankRacePoint[];
  delta: number; // last - first
}

export interface RankRaceData {
  series: RankRaceSeries[];
  /** Full domain (min,max ms) so all series share an axis. */
  domain: [number, number] | null;
}

export function rankRace(
  db: DB,
  opts: ComparisonOptions = {},
  queueType: string = SOLO_QUEUE,
): RankRaceData {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const series: RankRaceSeries[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of playerList) {
    const conds = [
      eq(playerRankSnapshots.puuid, p.puuid),
      eq(playerRankSnapshots.queueType, queueType),
    ];
    if (opts.sinceMs !== undefined) conds.push(gte(playerRankSnapshots.capturedAt, opts.sinceMs));
    const rows = db
      .select({
        capturedAt: playerRankSnapshots.capturedAt,
        tier: playerRankSnapshots.tier,
        rank: playerRankSnapshots.rank,
        leaguePoints: playerRankSnapshots.leaguePoints,
      })
      .from(playerRankSnapshots)
      .where(and(...conds))
      .orderBy(asc(playerRankSnapshots.capturedAt))
      .all();

    const points: RankRacePoint[] = [];
    for (const r of rows) {
      const scalar = rankToScalar(r.tier, r.rank, r.leaguePoints);
      if (scalar === null) continue;
      points.push({ t: r.capturedAt, lp: scalar });
      if (r.capturedAt < lo) lo = r.capturedAt;
      if (r.capturedAt > hi) hi = r.capturedAt;
    }
    if (points.length === 0) continue;
    series.push({
      puuid: p.puuid,
      displayName: p.displayName,
      points,
      delta: points[points.length - 1]!.lp - points[0]!.lp,
    });
  }
  series.sort((a, b) => b.delta - a.delta);
  return {
    series,
    domain: Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null,
  };
}

// ---------------------------------------------------------------------------
// 2. Head-to-Head Radar
// ---------------------------------------------------------------------------

const RADAR_AXES = [
  "KDA",
  "CS/min",
  "Gold/min",
  "Vision/g",
  "DPM",
  "KP%",
  "Obj DMG",
  "Survival",
] as const;

export type RadarAxis = (typeof RADAR_AXES)[number];

export interface RadarPlayer {
  puuid: string;
  displayName: string;
  /** Raw values per axis (same order as RADAR_AXES). */
  raw: number[];
  /** 0..1 normalized to the max across the comparison set. */
  norm: number[];
  games: number;
}

export interface RadarData {
  axes: ReadonlyArray<RadarAxis>;
  players: RadarPlayer[];
}

interface RadarAgg {
  puuid: string;
  games: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  vision: number;
  damage: number;
  objDmg: number;
  duration: number;
  timeDead: number;
  kpSum: number;
}

function radarAggForPuuids(
  db: DB,
  opts: ComparisonOptions,
  puuids: string[],
): RadarAgg[] {
  if (puuids.length === 0) return [];
  const conds = [...commonConds(opts), inArray(matchParticipants.puuid, puuids)];

  const teamKillsSub = db
    .select({
      matchId: matchParticipants.matchId,
      teamId: matchParticipants.teamId,
      teamKills: sql<number>`SUM(${matchParticipants.kills})`.as("team_kills"),
    })
    .from(matchParticipants)
    .groupBy(matchParticipants.matchId, matchParticipants.teamId)
    .as("tk");

  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      kills: sql<number>`COALESCE(SUM(${matchParticipants.kills}), 0)`,
      deaths: sql<number>`COALESCE(SUM(${matchParticipants.deaths}), 0)`,
      assists: sql<number>`COALESCE(SUM(${matchParticipants.assists}), 0)`,
      cs: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.totalMinionsKilled}, 0) + COALESCE(${matchParticipants.neutralMinionsKilled}, 0)), 0)`,
      gold: sql<number>`COALESCE(SUM(${matchParticipants.goldEarned}), 0)`,
      vision: sql<number>`COALESCE(SUM(${matchParticipants.visionScore}), 0)`,
      damage: sql<number>`COALESCE(SUM(${matchParticipants.totalDamageDealtToChampions}), 0)`,
      objDmg: sql<number>`COALESCE(SUM(${matchParticipants.damageDealtToObjectives}), 0)`,
      duration: sql<number>`COALESCE(SUM(${matches.gameDuration}), 0)`,
      timeDead: sql<number>`COALESCE(SUM(${matchParticipants.totalTimeSpentDead}), 0)`,
      kpSum: sql<number>`COALESCE(SUM(CASE WHEN ${teamKillsSub.teamKills} > 0 THEN (CAST(${matchParticipants.kills} + ${matchParticipants.assists} AS REAL) / ${teamKillsSub.teamKills}) ELSE 0 END), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(
      teamKillsSub,
      and(
        eq(teamKillsSub.matchId, matchParticipants.matchId),
        eq(teamKillsSub.teamId, matchParticipants.teamId),
      ),
    )
    .where(and(...conds, sql`${matches.gameMode} != 'CHERRY'`))
    .groupBy(matchParticipants.puuid)
    .all();

  return rows.map((r) => ({
    puuid: r.puuid,
    games: Number(r.games),
    kills: Number(r.kills),
    deaths: Number(r.deaths),
    assists: Number(r.assists),
    cs: Number(r.cs),
    gold: Number(r.gold),
    vision: Number(r.vision),
    damage: Number(r.damage),
    objDmg: Number(r.objDmg),
    duration: Number(r.duration),
    timeDead: Number(r.timeDead),
    kpSum: Number(r.kpSum),
  }));
}

function radarRaw(a: RadarAgg): number[] {
  const minutes = Math.max(1, a.duration / 60);
  const kda = (a.kills + a.assists) / Math.max(1, a.deaths);
  const csPerMin = a.cs / minutes;
  const goldPerMin = a.gold / minutes;
  const visionPerGame = a.games > 0 ? a.vision / a.games : 0;
  const dpm = a.damage / minutes;
  const kpPct = a.games > 0 ? (a.kpSum / a.games) * 100 : 0;
  const objPerMin = a.objDmg / minutes;
  // Survival: inverse of time-dead-share-of-duration. Higher is better.
  const deadShare = a.duration > 0 ? a.timeDead / a.duration : 1;
  const survival = Math.max(0, 1 - deadShare) * 100;
  return [kda, csPerMin, goldPerMin, visionPerGame, dpm, kpPct, objPerMin, survival];
}

export function radarCompare(
  db: DB,
  opts: ComparisonOptions = {},
  puuids?: string[],
): RadarData {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const targetPuuids = puuids && puuids.length > 0 ? puuids : playerList.map((p) => p.puuid);
  const aggs = radarAggForPuuids(db, opts, targetPuuids);
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));

  const players: RadarPlayer[] = aggs.map((a) => ({
    puuid: a.puuid,
    displayName: nameMap.get(a.puuid) ?? a.puuid,
    raw: radarRaw(a),
    norm: [],
    games: a.games,
  }));

  const axisMax = new Array(RADAR_AXES.length).fill(0);
  for (const p of players) {
    for (let i = 0; i < p.raw.length; i++) {
      if (p.raw[i]! > axisMax[i]) axisMax[i] = p.raw[i]!;
    }
  }
  for (const p of players) {
    p.norm = p.raw.map((v, i) => (axisMax[i] > 0 ? v / axisMax[i] : 0));
  }
  return { axes: RADAR_AXES, players };
}

// ---------------------------------------------------------------------------
// 3. Champion Affair Heatmap — top champions across all tracked players
// ---------------------------------------------------------------------------

export interface ChampionAffairCell {
  puuid: string;
  championName: string;
  games: number;
  wins: number;
  winrate: number;
}

export interface ChampionAffairData {
  players: PlayerLite[];
  champions: string[];
  cells: ChampionAffairCell[];
}

export function championAffair(
  db: DB,
  opts: ComparisonOptions = {},
  topN = 20,
): ChampionAffairData {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      championName: matchParticipants.championName,
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid, matchParticipants.championName)
    .all();

  const champTotals = new Map<string, number>();
  for (const r of rows) {
    champTotals.set(r.championName, (champTotals.get(r.championName) ?? 0) + Number(r.games));
  }
  const champions = [...champTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);
  const champSet = new Set(champions);

  const cells: ChampionAffairCell[] = rows
    .filter((r) => champSet.has(r.championName))
    .map((r) => {
      const games = Number(r.games);
      const wins = Number(r.wins);
      return {
        puuid: r.puuid,
        championName: r.championName,
        games,
        wins,
        winrate: games > 0 ? wins / games : 0,
      };
    });
  return { players: playerList, champions, cells };
}

// ---------------------------------------------------------------------------
// 4. Ballroom Floor — winrate by lane
// ---------------------------------------------------------------------------

export const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export type Lane = (typeof LANES)[number];

export interface LaneRow {
  puuid: string;
  displayName: string;
  byLane: Record<Lane, { games: number; wins: number; winrate: number }>;
}

export function laneDominance(db: DB, opts: ComparisonOptions = {}): LaneRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      lane: matchParticipants.teamPosition,
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid, matchParticipants.teamPosition)
    .all();

  const out: LaneRow[] = playerList.map((p) => ({
    puuid: p.puuid,
    displayName: p.displayName,
    byLane: Object.fromEntries(
      LANES.map((l) => [l, { games: 0, wins: 0, winrate: 0 }]),
    ) as LaneRow["byLane"],
  }));
  const byPuuid = new Map(out.map((r) => [r.puuid, r]));
  for (const r of rows) {
    const lane = (r.lane ?? "").toUpperCase() as Lane;
    if (!LANES.includes(lane)) continue;
    const entry = byPuuid.get(r.puuid);
    if (!entry) continue;
    const games = Number(r.games);
    const wins = Number(r.wins);
    entry.byLane[lane] = {
      games,
      wins,
      winrate: games > 0 ? wins / games : 0,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Gold Gatsby Curve — gold/min vs damage/min scatter (per match)
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  gpm: number;
  dpm: number;
}

export interface ScatterSeries {
  puuid: string;
  displayName: string;
  points: ScatterPoint[];
}

export function goldGatsbyCurve(
  db: DB,
  opts: ComparisonOptions = {},
): ScatterSeries[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
    sql`${matches.gameDuration} >= 300`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      gold: matchParticipants.goldEarned,
      dmg: matchParticipants.totalDamageDealtToChampions,
      duration: matches.gameDuration,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .all();

  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  const byPuuid = new Map<string, ScatterPoint[]>();
  for (const r of rows) {
    const minutes = r.duration / 60;
    if (minutes <= 0) continue;
    const arr = byPuuid.get(r.puuid) ?? [];
    arr.push({
      gpm: (r.gold ?? 0) / minutes,
      dpm: (r.dmg ?? 0) / minutes,
    });
    byPuuid.set(r.puuid, arr);
  }
  return [...byPuuid.entries()]
    .map(([puuid, points]) => ({
      puuid,
      displayName: nameMap.get(puuid) ?? puuid,
      points,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// 6. Vision Society — average wards placed / killed / control wards
// ---------------------------------------------------------------------------

export interface VisionRow {
  puuid: string;
  displayName: string;
  games: number;
  wardsPlaced: number;
  wardsKilled: number;
  controlWards: number;
  visionScore: number;
}

export function visionSociety(
  db: DB,
  opts: ComparisonOptions = {},
): VisionRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      wardsPlaced: sql<number>`COALESCE(SUM(${matchParticipants.wardsPlaced}), 0)`,
      wardsKilled: sql<number>`COALESCE(SUM(${matchParticipants.wardsKilled}), 0)`,
      controlWards: sql<number>`COALESCE(SUM(${matchParticipants.detectorWardsPlaced}), 0)`,
      vision: sql<number>`COALESCE(SUM(${matchParticipants.visionScore}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();

  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return rows
    .map((r) => {
      const games = Number(r.games);
      return {
        puuid: r.puuid,
        displayName: nameMap.get(r.puuid) ?? r.puuid,
        games,
        wardsPlaced: games > 0 ? Number(r.wardsPlaced) / games : 0,
        wardsKilled: games > 0 ? Number(r.wardsKilled) / games : 0,
        controlWards: games > 0 ? Number(r.controlWards) / games : 0,
        visionScore: games > 0 ? Number(r.vision) / games : 0,
      };
    })
    .sort((a, b) => b.visionScore - a.visionScore);
}

// ---------------------------------------------------------------------------
// 7. Pentakill Pageant — multi-kill tallies
// ---------------------------------------------------------------------------

export interface MultiKillRow {
  puuid: string;
  displayName: string;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
}

export function pentakillPageant(
  db: DB,
  opts: ComparisonOptions = {},
): MultiKillRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      doubles: sql<number>`COALESCE(SUM(${matchParticipants.doubleKills}), 0)`,
      triples: sql<number>`COALESCE(SUM(${matchParticipants.tripleKills}), 0)`,
      quads: sql<number>`COALESCE(SUM(${matchParticipants.quadraKills}), 0)`,
      pentas: sql<number>`COALESCE(SUM(${matchParticipants.pentaKills}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return playerList.map((p) => {
    const r = rows.find((x) => x.puuid === p.puuid);
    return {
      puuid: p.puuid,
      displayName: nameMap.get(p.puuid) ?? p.puuid,
      doubleKills: r ? Number(r.doubles) : 0,
      tripleKills: r ? Number(r.triples) : 0,
      quadraKills: r ? Number(r.quads) : 0,
      pentaKills: r ? Number(r.pentas) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// 8. Witching Hour Curve — winrate by hour of day
// ---------------------------------------------------------------------------

export interface HourlySeries {
  puuid: string;
  displayName: string;
  /** 24 entries, hour index 0..23. */
  hourly: Array<{ games: number; wins: number }>;
}

export function witchingHour(db: DB, opts: ComparisonOptions = {}): HourlySeries[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      gameStart: matches.gameStart,
      win: matchParticipants.win,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  const byPuuid = new Map<string, HourlySeries>();
  for (const p of playerList) {
    byPuuid.set(p.puuid, {
      puuid: p.puuid,
      displayName: p.displayName,
      hourly: Array.from({ length: 24 }, () => ({ games: 0, wins: 0 })),
    });
  }
  for (const r of rows) {
    const hour = new Date(r.gameStart).getHours();
    const series = byPuuid.get(r.puuid);
    if (!series) continue;
    const bucket = series.hourly[hour]!;
    bucket.games += 1;
    if (r.win) bucket.wins += 1;
  }
  return [...byPuuid.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

// ---------------------------------------------------------------------------
// 9. Objective Orchestra — dragons / barons / towers / inhibitors per player
// ---------------------------------------------------------------------------

export interface ObjectiveRow {
  puuid: string;
  displayName: string;
  games: number;
  dragons: number;
  barons: number;
  turrets: number;
  inhibitors: number;
  stolen: number;
}

export function objectiveOrchestra(
  db: DB,
  opts: ComparisonOptions = {},
): ObjectiveRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      dragons: sql<number>`COALESCE(SUM(${matchParticipants.dragonKills}), 0)`,
      barons: sql<number>`COALESCE(SUM(${matchParticipants.baronKills}), 0)`,
      turrets: sql<number>`COALESCE(SUM(${matchParticipants.turretKills}), 0)`,
      inhibitors: sql<number>`COALESCE(SUM(${matchParticipants.inhibitorKills}), 0)`,
      stolen: sql<number>`COALESCE(SUM(${matchParticipants.objectivesStolen}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return playerList
    .map((p) => {
      const r = rows.find((x) => x.puuid === p.puuid);
      return {
        puuid: p.puuid,
        displayName: nameMap.get(p.puuid) ?? p.puuid,
        games: r ? Number(r.games) : 0,
        dragons: r ? Number(r.dragons) : 0,
        barons: r ? Number(r.barons) : 0,
        turrets: r ? Number(r.turrets) : 0,
        inhibitors: r ? Number(r.inhibitors) : 0,
        stolen: r ? Number(r.stolen) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.dragons + b.barons + b.turrets + b.inhibitors -
        (a.dragons + a.barons + a.turrets + a.inhibitors),
    );
}

// ---------------------------------------------------------------------------
// 10. Crown of the Evening — daily MVP (Gatsby Score)
// ---------------------------------------------------------------------------

export interface CrownEntry {
  dayKey: string; // YYYY-MM-DD in server-local TZ
  dayMs: number; // start-of-day ms
  mvpPuuid: string | null;
  mvpDisplayName: string | null;
  mvpScore: number;
  jesterPuuid: string | null;
  jesterDisplayName: string | null;
  jesterScore: number;
  /** Per-player scores for that day. */
  scores: Array<{ puuid: string; displayName: string; score: number; games: number }>;
}

interface CrownMatchRow {
  matchId: string;
  puuid: string;
  teamId: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  vision: number;
  dragons: number;
  barons: number;
  turrets: number;
  win: boolean;
  gameStart: number;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function crownOfTheEvening(
  db: DB,
  opts: ComparisonOptions = {},
  limitDays = 14,
): CrownEntry[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  const trackedSet = new Set(playerList.map((p) => p.puuid));
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      matchId: matchParticipants.matchId,
      puuid: matchParticipants.puuid,
      teamId: matchParticipants.teamId,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
      damage: matchParticipants.totalDamageDealtToChampions,
      vision: matchParticipants.visionScore,
      dragons: matchParticipants.dragonKills,
      barons: matchParticipants.baronKills,
      turrets: matchParticipants.turretKills,
      win: matchParticipants.win,
      gameStart: matches.gameStart,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .orderBy(desc(matches.gameStart))
    .all();

  // Index team kills per (matchId, teamId) for KP, restricted to tracked rows.
  const teamKillsByMatch = new Map<string, Map<number, number>>();
  // We need ALL participants of those matches to compute team kills properly.
  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  if (matchIds.length > 0) {
    const tk = db
      .select({
        matchId: matchParticipants.matchId,
        teamId: matchParticipants.teamId,
        kills: sql<number>`SUM(${matchParticipants.kills})`,
      })
      .from(matchParticipants)
      .where(inArray(matchParticipants.matchId, matchIds))
      .groupBy(matchParticipants.matchId, matchParticipants.teamId)
      .all();
    for (const r of tk) {
      const m = teamKillsByMatch.get(r.matchId) ?? new Map<number, number>();
      m.set(r.teamId, Number(r.kills));
      teamKillsByMatch.set(r.matchId, m);
    }
  }

  interface Acc {
    score: number;
    games: number;
  }
  const byDay = new Map<string, Map<string, Acc>>();

  for (const r of rows as CrownMatchRow[]) {
    if (!trackedSet.has(r.puuid)) continue;
    const tk = teamKillsByMatch.get(r.matchId)?.get(r.teamId) ?? 0;
    const kp = tk > 0 ? (r.kills + r.assists) / tk : 0;
    const kda = (r.kills + r.assists) / Math.max(1, r.deaths);
    // Gatsby Score: weighted composite, normalized rough-and-ready
    const score =
      2.0 * Math.min(8, kda) +
      4.0 * Math.min(1, kp) +
      0.0006 * r.damage +
      0.04 * r.vision +
      1.5 * (r.dragons + r.barons) +
      0.4 * r.turrets +
      (r.win ? 2.0 : -1.0) -
      0.4 * Math.max(0, r.deaths - 6);
    const key = dayKey(r.gameStart);
    const dayMap = byDay.get(key) ?? new Map<string, Acc>();
    const acc = dayMap.get(r.puuid) ?? { score: 0, games: 0 };
    acc.score += score;
    acc.games += 1;
    dayMap.set(r.puuid, acc);
    byDay.set(key, dayMap);
  }

  const entries: CrownEntry[] = [];
  const sortedKeys = [...byDay.keys()].sort().reverse().slice(0, limitDays);
  for (const key of sortedKeys) {
    const dayMap = byDay.get(key)!;
    const scores = [...dayMap.entries()]
      .map(([puuid, acc]) => ({
        puuid,
        displayName: nameMap.get(puuid) ?? puuid,
        score: acc.score / Math.max(1, acc.games),
        games: acc.games,
      }))
      .sort((a, b) => b.score - a.score);
    const mvp = scores[0];
    const jester = scores[scores.length - 1];
    // Compute dayMs from any match in that day:
    const sampleStart = rows.find((r) => dayKey(r.gameStart) === key)?.gameStart ?? Date.now();
    entries.push({
      dayKey: key,
      dayMs: dayStartMs(sampleStart),
      mvpPuuid: mvp?.puuid ?? null,
      mvpDisplayName: mvp?.displayName ?? null,
      mvpScore: mvp?.score ?? 0,
      jesterPuuid: scores.length > 1 ? jester?.puuid ?? null : null,
      jesterDisplayName: scores.length > 1 ? jester?.displayName ?? null : null,
      jesterScore: scores.length > 1 ? jester?.score ?? 0 : 0,
      scores,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 11. Damage Profile — physical / magic / true damage breakdown
// ---------------------------------------------------------------------------

export interface DamageProfileRow {
  puuid: string;
  displayName: string;
  games: number;
  physical: number;
  magic: number;
  trueDmg: number;
  total: number;
}

export function damageProfile(
  db: DB,
  opts: ComparisonOptions = {},
): DamageProfileRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      physical: sql<number>`COALESCE(SUM(${matchParticipants.physicalDamageToChampions}), 0)`,
      magic: sql<number>`COALESCE(SUM(${matchParticipants.magicDamageToChampions}), 0)`,
      trueDmg: sql<number>`COALESCE(SUM(${matchParticipants.trueDamageToChampions}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return rows
    .map((r) => {
      const physical = Number(r.physical);
      const magic = Number(r.magic);
      const trueDmg = Number(r.trueDmg);
      return {
        puuid: r.puuid,
        displayName: nameMap.get(r.puuid) ?? r.puuid,
        games: Number(r.games),
        physical,
        magic,
        trueDmg,
        total: physical + magic + trueDmg,
      };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// 12. First Blood Brigade — first-blood and first-tower tallies
// ---------------------------------------------------------------------------

export interface FirstBloodRow {
  puuid: string;
  displayName: string;
  games: number;
  firstBloodKills: number;
  firstBloodAssists: number;
  firstTowerKills: number;
  firstTowerAssists: number;
}

export function firstBloodBrigade(
  db: DB,
  opts: ComparisonOptions = {},
): FirstBloodRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      fbKills: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.firstBloodKill} = 1 THEN 1 ELSE 0 END), 0)`,
      fbAssists: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.firstBloodAssist} = 1 THEN 1 ELSE 0 END), 0)`,
      ftKills: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.firstTowerKill} = 1 THEN 1 ELSE 0 END), 0)`,
      ftAssists: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.firstTowerAssist} = 1 THEN 1 ELSE 0 END), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return playerList
    .map((p) => {
      const r = rows.find((x) => x.puuid === p.puuid);
      return {
        puuid: p.puuid,
        displayName: nameMap.get(p.puuid) ?? p.puuid,
        games: r ? Number(r.games) : 0,
        firstBloodKills: r ? Number(r.fbKills) : 0,
        firstBloodAssists: r ? Number(r.fbAssists) : 0,
        firstTowerKills: r ? Number(r.ftKills) : 0,
        firstTowerAssists: r ? Number(r.ftAssists) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.firstBloodKills + b.firstTowerKills -
        (a.firstBloodKills + a.firstTowerKills),
    );
}

// ---------------------------------------------------------------------------
// 13. Surrender Society — FF/played-out behaviour
// ---------------------------------------------------------------------------

export interface SurrenderRow {
  puuid: string;
  displayName: string;
  games: number;
  /** Game played to the nexus. */
  played: number;
  /** Our team waved the white flag. */
  ownTeamFF: number;
  /** Opponents surrendered. */
  enemyFF: number;
}

export function surrenderSociety(
  db: DB,
  opts: ComparisonOptions = {},
): SurrenderRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      // No surrender at all
      played: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.gameEndedInSurrender} IS NULL OR ${matchParticipants.gameEndedInSurrender} = 0 THEN 1 ELSE 0 END), 0)`,
      // Surrender + we lost = our team FF'd
      ownTeamFF: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.gameEndedInSurrender} = 1 AND ${matchParticipants.win} = 0 THEN 1 ELSE 0 END), 0)`,
      // Surrender + we won = enemy FF'd
      enemyFF: sql<number>`COALESCE(SUM(CASE WHEN ${matchParticipants.gameEndedInSurrender} = 1 AND ${matchParticipants.win} = 1 THEN 1 ELSE 0 END), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  const nameMap = new Map(playerList.map((p) => [p.puuid, p.displayName]));
  return playerList
    .map((p) => {
      const r = rows.find((x) => x.puuid === p.puuid);
      return {
        puuid: p.puuid,
        displayName: nameMap.get(p.puuid) ?? p.puuid,
        games: r ? Number(r.games) : 0,
        played: r ? Number(r.played) : 0,
        ownTeamFF: r ? Number(r.ownTeamFF) : 0,
        enemyFF: r ? Number(r.enemyFF) : 0,
      };
    })
    .sort((a, b) => b.games - a.games);
}

// ---------------------------------------------------------------------------
// 14. Duration Devils — winrate by game length bucket
// ---------------------------------------------------------------------------

export const DURATION_BUCKETS = ["short", "medium", "long"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** seconds — short < 25min, 25-35min mid, > 35min long. */
const SHORT_SEC = 25 * 60;
const LONG_SEC = 35 * 60;

export interface DurationRow {
  puuid: string;
  displayName: string;
  byBucket: Record<DurationBucket, { games: number; wins: number; winrate: number }>;
}

export function durationDevils(
  db: DB,
  opts: ComparisonOptions = {},
): DurationRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
    sql`${matches.gameMode} != 'CHERRY'`,
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      duration: matches.gameDuration,
      win: matchParticipants.win,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .all();
  const out: DurationRow[] = playerList.map((p) => ({
    puuid: p.puuid,
    displayName: p.displayName,
    byBucket: Object.fromEntries(
      DURATION_BUCKETS.map((b) => [b, { games: 0, wins: 0, winrate: 0 }]),
    ) as DurationRow["byBucket"],
  }));
  const byPuuid = new Map(out.map((r) => [r.puuid, r]));
  for (const r of rows) {
    const entry = byPuuid.get(r.puuid);
    if (!entry) continue;
    const bucket: DurationBucket =
      r.duration < SHORT_SEC ? "short" : r.duration > LONG_SEC ? "long" : "medium";
    const cell = entry.byBucket[bucket];
    cell.games += 1;
    if (r.win) cell.wins += 1;
  }
  for (const entry of out) {
    for (const b of DURATION_BUCKETS) {
      const cell = entry.byBucket[b];
      cell.winrate = cell.games > 0 ? cell.wins / cell.games : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 15. Day of the Week — winrate by weekday
// ---------------------------------------------------------------------------

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface WeekdayRow {
  puuid: string;
  displayName: string;
  /** 7 entries, Mon..Sun. */
  byDay: Array<{ games: number; wins: number }>;
}

export function dayOfWeek(db: DB, opts: ComparisonOptions = {}): WeekdayRow[] {
  const playerList = readPlayers(db, opts.excludedPuuids);
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, playerList.map((p) => p.puuid)),
  ];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      gameStart: matches.gameStart,
      win: matchParticipants.win,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .all();
  const byPuuid = new Map<string, WeekdayRow>();
  for (const p of playerList) {
    byPuuid.set(p.puuid, {
      puuid: p.puuid,
      displayName: p.displayName,
      byDay: Array.from({ length: 7 }, () => ({ games: 0, wins: 0 })),
    });
  }
  for (const r of rows) {
    const d = new Date(r.gameStart);
    const jsDay = d.getDay();
    const dayIdx = (jsDay + 6) % 7;
    const series = byPuuid.get(r.puuid);
    if (!series) continue;
    const bucket = series.byDay[dayIdx]!;
    bucket.games += 1;
    if (r.win) bucket.wins += 1;
  }
  return [...byPuuid.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

// ---------------------------------------------------------------------------
// Bundle for the /gatsby page
// ---------------------------------------------------------------------------

export interface PavilionData {
  rankRace: RankRaceData;
  rankRaceFlex: RankRaceData;
  radar: RadarData;
  champions: ChampionAffairData;
  lanes: LaneRow[];
  goldCurve: ScatterSeries[];
  vision: VisionRow[];
  multikills: MultiKillRow[];
  hourly: HourlySeries[];
  objectives: ObjectiveRow[];
  crowns: CrownEntry[];
  damage: DamageProfileRow[];
  firstBlood: FirstBloodRow[];
  surrender: SurrenderRow[];
  duration: DurationRow[];
  weekday: WeekdayRow[];
}

export function pavilionData(db: DB, opts: ComparisonOptions = {}): PavilionData {
  return {
    rankRace: rankRace(db, opts, SOLO_QUEUE),
    rankRaceFlex: rankRace(db, opts, FLEX_QUEUE),
    radar: radarCompare(db, opts),
    champions: championAffair(db, opts),
    lanes: laneDominance(db, opts),
    goldCurve: goldGatsbyCurve(db, opts),
    vision: visionSociety(db, opts),
    multikills: pentakillPageant(db, opts),
    hourly: witchingHour(db, opts),
    objectives: objectiveOrchestra(db, opts),
    crowns: crownOfTheEvening(db, opts),
    damage: damageProfile(db, opts),
    firstBlood: firstBloodBrigade(db, opts),
    surrender: surrenderSociety(db, opts),
    duration: durationDevils(db, opts),
    weekday: dayOfWeek(db, opts),
  };
}
