import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "./connect.js";
import {
  matchParticipants,
  matches,
  playerRankSnapshots,
  players,
} from "./schema.js";

export interface LeaderboardRow {
  puuid: string;
  displayName: string;
  value: number | null;
  display: string;
  qualifies: boolean;
}

export interface LeaderboardCategory {
  key: string;
  label: string;
  unit: string;
  rows: LeaderboardRow[];
}

export interface LeaderboardData {
  categories: LeaderboardCategory[];
}

export interface LeaderboardOptions {
  sinceMs?: number | undefined;
  queueIds?: number[] | undefined;
}

const SOLO_QUEUE = "RANKED_SOLO_5x5";
const MIN_WINRATE_GAMES = 5;

const TIER_RANK: Record<string, number> = {
  IRON: 1,
  BRONZE: 2,
  SILVER: 3,
  GOLD: 4,
  PLATINUM: 5,
  EMERALD: 6,
  DIAMOND: 7,
  MASTER: 8,
  GRANDMASTER: 9,
  CHALLENGER: 10,
};

const DIVISION_OFFSET: Record<string, number> = {
  I: 300,
  II: 200,
  III: 100,
  IV: 0,
};

const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

function lpScalar(
  tier: string | null,
  rank: string | null,
  lp: number | null,
): number | null {
  if (!tier) return null;
  const tierKey = tier.toUpperCase();
  const tierRank = TIER_RANK[tierKey];
  if (tierRank === undefined) return null;
  const divisionOffset = APEX_TIERS.has(tierKey)
    ? 0
    : DIVISION_OFFSET[(rank ?? "IV").toUpperCase()] ?? 0;
  return tierRank * 1000 + divisionOffset + (lp ?? 0);
}

function tierBadge(
  tier: string | null,
  rank: string | null,
  lp: number | null,
): string {
  if (!tier) return "—";
  const tierKey = tier.toUpperCase();
  const cap = tierKey.charAt(0) + tierKey.slice(1).toLowerCase();
  if (APEX_TIERS.has(tierKey)) return `${cap} ${lp ?? 0} LP`;
  return `${cap} ${rank ?? ""} ${lp ?? 0} LP`.trim();
}

function fmtPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function fmtNumber(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

interface PlayerName {
  puuid: string;
  displayName: string;
}

function readPlayers(db: DB): PlayerName[] {
  return db
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
}

interface NumericMetric {
  puuid: string;
  value: number;
  games: number;
}

function commonConds(opts: LeaderboardOptions) {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));
  return conds;
}

function perMinExcludeArena(opts: LeaderboardOptions): boolean {
  // Arena minute-based metrics are weird. If the user explicitly filtered to
  // arena via queueIds (1700/1710), keep arena games. Otherwise exclude.
  if (!opts.queueIds || opts.queueIds.length === 0) return true;
  const onlyArena = opts.queueIds.every((id) => id === 1700 || id === 1710);
  return !onlyArena;
}

/**
 * Win rate. Qualifies with >= 5 games in window/queue.
 */
function winRateRows(
  db: DB,
  opts: LeaderboardOptions,
  names: Map<string, string>,
): LeaderboardRow[] {
  const conds = [...commonConds(opts), inArray(matchParticipants.puuid, [...names.keys()])];
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      wins: sql<number>`SUM(CASE WHEN ${matchParticipants.win} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();

  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const games = Number(r.games);
    const wins = Number(r.wins);
    const winrate = games > 0 ? (wins / games) * 100 : 0;
    const qualifies = games >= MIN_WINRATE_GAMES;
    seen.add(r.puuid);
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: qualifies ? winrate : null,
      display: qualifies
        ? `${fmtPercent(winrate)} (${wins}/${games})`
        : `— (${games}/${MIN_WINRATE_GAMES})`,
      qualifies,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: null,
      display: `— (0/${MIN_WINRATE_GAMES})`,
      qualifies: false,
    });
  }
  return sortRows(out, "desc");
}

interface AggRow {
  puuid: string;
  games: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalDamage: number;
  totalGold: number;
  totalCs: number;
  totalVision: number;
  totalDurationSec: number;
  totalPentas: number;
}

function aggregateParticipants(
  db: DB,
  opts: LeaderboardOptions,
  puuids: string[],
  excludeArena: boolean,
): AggRow[] {
  const conds = [
    ...commonConds(opts),
    inArray(matchParticipants.puuid, puuids),
  ];
  if (excludeArena) {
    conds.push(sql`${matches.gameMode} != 'CHERRY'`);
  }
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      games: sql<number>`COUNT(*)`,
      totalKills: sql<number>`COALESCE(SUM(${matchParticipants.kills}), 0)`,
      totalDeaths: sql<number>`COALESCE(SUM(${matchParticipants.deaths}), 0)`,
      totalAssists: sql<number>`COALESCE(SUM(${matchParticipants.assists}), 0)`,
      totalDamage: sql<number>`COALESCE(SUM(${matchParticipants.totalDamageDealtToChampions}), 0)`,
      totalGold: sql<number>`COALESCE(SUM(${matchParticipants.goldEarned}), 0)`,
      totalCs: sql<number>`COALESCE(SUM(COALESCE(${matchParticipants.totalMinionsKilled}, 0) + COALESCE(${matchParticipants.neutralMinionsKilled}, 0)), 0)`,
      totalVision: sql<number>`COALESCE(SUM(${matchParticipants.visionScore}), 0)`,
      totalDurationSec: sql<number>`COALESCE(SUM(${matches.gameDuration}), 0)`,
      totalPentas: sql<number>`COALESCE(SUM(${matchParticipants.pentaKills}), 0)`,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();
  return rows.map((r) => ({
    puuid: r.puuid,
    games: Number(r.games),
    totalKills: Number(r.totalKills),
    totalDeaths: Number(r.totalDeaths),
    totalAssists: Number(r.totalAssists),
    totalDamage: Number(r.totalDamage),
    totalGold: Number(r.totalGold),
    totalCs: Number(r.totalCs),
    totalVision: Number(r.totalVision),
    totalDurationSec: Number(r.totalDurationSec),
    totalPentas: Number(r.totalPentas),
  }));
}

function sortRows(rows: LeaderboardRow[], dir: "desc" | "asc"): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    if (a.value === null && b.value === null) {
      return a.displayName.localeCompare(b.displayName);
    }
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return dir === "desc" ? b.value - a.value : a.value - b.value;
  });
}

/**
 * Kill participation: for each (match, puuid) compute (kills+assists)/teamKills,
 * then average per game per player.
 */
function killParticipationRows(
  db: DB,
  opts: LeaderboardOptions,
  names: Map<string, string>,
): LeaderboardRow[] {
  const puuids = [...names.keys()];
  if (puuids.length === 0) return [];
  const conds = [...commonConds(opts), inArray(matchParticipants.puuid, puuids)];

  // Subquery: team kills per (matchId, teamId)
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
    .where(and(...conds))
    .groupBy(matchParticipants.puuid)
    .all();

  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const games = Number(r.games);
    const kpSum = Number(r.kpSum);
    if (games === 0) continue;
    seen.add(r.puuid);
    const avg = (kpSum / games) * 100;
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: avg,
      display: `${fmtPercent(avg)} (${games}g)`,
      qualifies: true,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: null,
      display: "—",
      qualifies: false,
    });
  }
  return sortRows(out, "desc");
}

function perMinRows(
  agg: AggRow[],
  names: Map<string, string>,
  pickTotal: (r: AggRow) => number,
  formatter: (perMin: number) => string,
): LeaderboardRow[] {
  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of agg) {
    seen.add(r.puuid);
    if (r.totalDurationSec <= 0 || r.games === 0) {
      out.push({
        puuid: r.puuid,
        displayName: names.get(r.puuid) ?? r.puuid,
        value: null,
        display: "—",
        qualifies: false,
      });
      continue;
    }
    const minutes = r.totalDurationSec / 60;
    const perMin = pickTotal(r) / minutes;
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: perMin,
      display: `${formatter(perMin)} (${r.games}g)`,
      qualifies: true,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: null,
      display: "—",
      qualifies: false,
    });
  }
  return sortRows(out, "desc");
}

function kdaRows(agg: AggRow[], names: Map<string, string>): LeaderboardRow[] {
  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of agg) {
    seen.add(r.puuid);
    if (r.games === 0) {
      out.push({
        puuid: r.puuid,
        displayName: names.get(r.puuid) ?? r.puuid,
        value: null,
        display: "—",
        qualifies: false,
      });
      continue;
    }
    const kda = (r.totalKills + r.totalAssists) / Math.max(1, r.totalDeaths);
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: kda,
      display: `${fmtNumber(kda)} (${r.totalKills}/${r.totalDeaths}/${r.totalAssists})`,
      qualifies: true,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: null,
      display: "—",
      qualifies: false,
    });
  }
  return sortRows(out, "desc");
}

function visionPerGameRows(agg: AggRow[], names: Map<string, string>): LeaderboardRow[] {
  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of agg) {
    seen.add(r.puuid);
    if (r.games === 0) {
      out.push({
        puuid: r.puuid,
        displayName: names.get(r.puuid) ?? r.puuid,
        value: null,
        display: "—",
        qualifies: false,
      });
      continue;
    }
    const avg = r.totalVision / r.games;
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: avg,
      display: `${fmtNumber(avg, 1)} (${r.games}g)`,
      qualifies: true,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: null,
      display: "—",
      qualifies: false,
    });
  }
  return sortRows(out, "desc");
}

function pentakillRows(agg: AggRow[], names: Map<string, string>): LeaderboardRow[] {
  const out: LeaderboardRow[] = [];
  const seen = new Set<string>();
  for (const r of agg) {
    seen.add(r.puuid);
    out.push({
      puuid: r.puuid,
      displayName: names.get(r.puuid) ?? r.puuid,
      value: r.totalPentas,
      display: r.totalPentas > 0 ? `${r.totalPentas}` : "0",
      qualifies: true,
    });
  }
  for (const [puuid, displayName] of names) {
    if (seen.has(puuid)) continue;
    out.push({
      puuid,
      displayName,
      value: 0,
      display: "0",
      qualifies: true,
    });
  }
  return sortRows(out, "desc");
}

/**
 * Latest soloq snapshot by (puuid, capturedAt desc) where tier is set.
 */
function currentLpRows(
  db: DB,
  names: Map<string, string>,
): LeaderboardRow[] {
  const out: LeaderboardRow[] = [];
  for (const [puuid, displayName] of names) {
    const snap = db
      .select({
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
      .orderBy(desc(playerRankSnapshots.capturedAt))
      .limit(1)
      .get();
    if (!snap || !snap.tier) {
      out.push({
        puuid,
        displayName,
        value: null,
        display: "—",
        qualifies: false,
      });
      continue;
    }
    const scalar = lpScalar(snap.tier, snap.rank, snap.leaguePoints);
    out.push({
      puuid,
      displayName,
      value: scalar,
      display: tierBadge(snap.tier, snap.rank, snap.leaguePoints),
      qualifies: scalar !== null,
    });
  }
  return sortRows(out, "desc");
}

/**
 * Longest current win streak: from the most recent match backward within
 * the window/queue, count consecutive wins per player.
 */
function winStreakRows(
  db: DB,
  opts: LeaderboardOptions,
  names: Map<string, string>,
): LeaderboardRow[] {
  const puuids = [...names.keys()];
  if (puuids.length === 0) return [];
  const conds = [...commonConds(opts), inArray(matchParticipants.puuid, puuids)];

  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      gameStart: matches.gameStart,
      win: matchParticipants.win,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .orderBy(asc(matchParticipants.puuid), desc(matches.gameStart))
    .all();

  const byPuuid = new Map<string, Array<{ gameStart: number; win: boolean }>>();
  for (const r of rows) {
    const arr = byPuuid.get(r.puuid) ?? [];
    arr.push({ gameStart: r.gameStart, win: Boolean(r.win) });
    byPuuid.set(r.puuid, arr);
  }

  const out: LeaderboardRow[] = [];
  for (const [puuid, displayName] of names) {
    const matchesForPlayer = byPuuid.get(puuid) ?? [];
    if (matchesForPlayer.length === 0) {
      out.push({
        puuid,
        displayName,
        value: null,
        display: "—",
        qualifies: false,
      });
      continue;
    }
    let streak = 0;
    for (const m of matchesForPlayer) {
      if (m.win) streak++;
      else break;
    }
    out.push({
      puuid,
      displayName,
      value: streak,
      display: streak > 0 ? `${streak}W` : "0",
      qualifies: true,
    });
  }
  return sortRows(out, "desc");
}

export function getLeaderboards(
  db: DB,
  opts: LeaderboardOptions = {},
): LeaderboardData {
  const playerList = readPlayers(db);
  const names = new Map<string, string>(
    playerList.map((p) => [p.puuid, p.displayName]),
  );

  const excludeArena = perMinExcludeArena(opts);
  const agg = aggregateParticipants(db, opts, [...names.keys()], excludeArena);

  const categories: LeaderboardCategory[] = [
    {
      key: "winrate",
      label: "Win rate",
      unit: "%",
      rows: winRateRows(db, opts, names),
    },
    {
      key: "kda",
      label: "KDA",
      unit: "",
      rows: kdaRows(agg, names),
    },
    {
      key: "kp",
      label: "Kill participation",
      unit: "%",
      rows: killParticipationRows(db, opts, names),
    },
    {
      key: "dpm",
      label: "Damage / min",
      unit: "dpm",
      rows: perMinRows(
        agg,
        names,
        (r) => r.totalDamage,
        (perMin) => fmtInt(perMin),
      ),
    },
    {
      key: "gpm",
      label: "Gold / min",
      unit: "gpm",
      rows: perMinRows(
        agg,
        names,
        (r) => r.totalGold,
        (perMin) => fmtInt(perMin),
      ),
    },
    {
      key: "cspm",
      label: "CS / min",
      unit: "cs/min",
      rows: perMinRows(
        agg,
        names,
        (r) => r.totalCs,
        (perMin) => fmtNumber(perMin, 1),
      ),
    },
    {
      key: "vision",
      label: "Vision / game",
      unit: "",
      rows: visionPerGameRows(agg, names),
    },
    {
      key: "lp",
      label: "Solo Queue LP",
      unit: "",
      rows: currentLpRows(db, names),
    },
    {
      key: "pentas",
      label: "Pentakills",
      unit: "",
      rows: pentakillRows(agg, names),
    },
    {
      key: "streak",
      label: "Current win streak",
      unit: "W",
      rows: winStreakRows(db, opts, names),
    },
  ];

  return { categories };
}
