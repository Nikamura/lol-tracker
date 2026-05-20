import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "./connect.js";
import { notRemakeCond } from "./match-filters.js";
import { gatsbyScore } from "./mvp-score.js";
import { matchParticipants, matches, players } from "./schema.js";
import { queryParties, type PartyRow } from "./queries.js";

/**
 * "Day" here is server-local calendar day. We compute the start-of-day in
 * server-local TZ via Date#setHours(0,0,0,0) so the SQL layer can range over
 * matching gameStart millis. This matches the existing dayKey() convention in
 * comparison-queries.ts.
 */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** YYYY-MM-DD in server-local TZ → start-of-day ms. Returns null if malformed. */
export function parseDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface DayOption {
  dayKey: string;
  dayMs: number;
  friendCount: number;
  matchCount: number;
}

/**
 * Days where at least two distinct tracked friends each played a non-remake
 * match. Returned newest-first. Calendar day is server-local TZ.
 */
export function listMultiFriendDays(db: DB): DayOption[] {
  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      matchId: matches.matchId,
      gameStart: matches.gameStart,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .where(notRemakeCond())
    .all();

  interface Acc {
    friends: Set<string>;
    matches: Set<string>;
    sampleMs: number;
  }
  const byDay = new Map<string, Acc>();
  for (const r of rows) {
    const key = dayKeyOf(r.gameStart);
    let acc = byDay.get(key);
    if (!acc) {
      acc = { friends: new Set(), matches: new Set(), sampleMs: r.gameStart };
      byDay.set(key, acc);
    }
    acc.friends.add(r.puuid);
    acc.matches.add(r.matchId);
  }

  const out: DayOption[] = [];
  for (const [key, acc] of byDay) {
    if (acc.friends.size < 2) continue;
    out.push({
      dayKey: key,
      dayMs: startOfDayMs(acc.sampleMs),
      friendCount: acc.friends.size,
      matchCount: acc.matches.size,
    });
  }
  out.sort((a, b) => b.dayMs - a.dayMs);
  return out;
}

export interface DailyPlayerStat {
  puuid: string;
  displayName: string;
  games: number;
  wins: number;
  losses: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalDamage: number;
  totalGold: number;
  totalCs: number;
  totalDuration: number;
  totalVision: number;
  totalWardsPlaced: number;
  totalWardsKilled: number;
  totalControlWards: number;
  totalTimeDead: number;
  /** Sum of (kills+assists)/teamKills across games, divided later by games. */
  kpSum: number;
  firstBloodKills: number;
  firstBloodAssists: number;
  firstTowerKills: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  doubleKills: number;
  dragonKills: number;
  baronKills: number;
  turretKills: number;
  objectivesStolen: number;
  ownTeamFF: number;
  enemyFF: number;
  mvpScoreSum: number;
}

/** Derived per-game averages. Returned by ratioed(). */
export interface DailyPlayerRatios {
  avgKda: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKP: number; // 0..1
  avgVision: number;
  avgDpm: number;
  avgGpm: number;
  avgCsPerMin: number;
  avgDamage: number;
  avgGold: number;
  avgMvpScore: number;
  winrate: number;
}

export function ratiosFor(s: DailyPlayerStat): DailyPlayerRatios {
  const games = Math.max(1, s.games);
  const minutes = Math.max(1, s.totalDuration / 60);
  return {
    avgKda: (s.totalKills + s.totalAssists) / Math.max(1, s.totalDeaths),
    avgKills: s.totalKills / games,
    avgDeaths: s.totalDeaths / games,
    avgAssists: s.totalAssists / games,
    avgKP: s.kpSum / games,
    avgVision: s.totalVision / games,
    avgDpm: s.totalDamage / minutes,
    avgGpm: s.totalGold / minutes,
    avgCsPerMin: s.totalCs / minutes,
    avgDamage: s.totalDamage / games,
    avgGold: s.totalGold / games,
    avgMvpScore: s.mvpScoreSum / games,
    winrate: s.games > 0 ? s.wins / s.games : 0,
  };
}

export interface DailyComparison {
  dayKey: string;
  dayMs: number;
  prevDayMs: number | null;
  nextDayMs: number | null;
  /** Per-player aggregates, sorted by avg MVP score desc. */
  stats: DailyPlayerStat[];
  totalMatches: number;
  parties: PartyRow[];
}

/**
 * Aggregate stats for every tracked friend that played a non-remake game on
 * the given calendar day. Includes Arena (CHERRY) so banter can cover all
 * games — the existing Crown query excludes CHERRY, but for end-of-day awards
 * we want everything the friend group did.
 */
export function dailyComparison(db: DB, dayMs: number): DailyComparison {
  const startMs = startOfDayMs(dayMs);
  const endMs = endOfDayMs(dayMs);
  const days = listMultiFriendDays(db);
  const idx = days.findIndex((d) => d.dayMs === startMs);
  const prevDayMs = idx >= 0 && idx + 1 < days.length ? days[idx + 1]!.dayMs : null;
  const nextDayMs = idx > 0 ? days[idx - 1]!.dayMs : null;

  const rows = db
    .select({
      matchId: matchParticipants.matchId,
      puuid: matchParticipants.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
      teamId: matchParticipants.teamId,
      teamPosition: matchParticipants.teamPosition,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
      damage: matchParticipants.totalDamageDealtToChampions,
      damageTaken: matchParticipants.totalDamageTaken,
      damageToBuildings: matchParticipants.damageDealtToBuildings,
      vision: matchParticipants.visionScore,
      wardsPlaced: matchParticipants.wardsPlaced,
      wardsKilled: matchParticipants.wardsKilled,
      controlWards: matchParticipants.detectorWardsPlaced,
      timeDead: matchParticipants.totalTimeSpentDead,
      gold: matchParticipants.goldEarned,
      totalMinionsKilled: matchParticipants.totalMinionsKilled,
      neutralMinionsKilled: matchParticipants.neutralMinionsKilled,
      firstBloodKill: matchParticipants.firstBloodKill,
      firstBloodAssist: matchParticipants.firstBloodAssist,
      firstTowerKill: matchParticipants.firstTowerKill,
      pentaKills: matchParticipants.pentaKills,
      quadraKills: matchParticipants.quadraKills,
      tripleKills: matchParticipants.tripleKills,
      doubleKills: matchParticipants.doubleKills,
      dragonKills: matchParticipants.dragonKills,
      baronKills: matchParticipants.baronKills,
      turretKills: matchParticipants.turretKills,
      objectivesStolen: matchParticipants.objectivesStolen,
      gameEndedInSurrender: matchParticipants.gameEndedInSurrender,
      win: matchParticipants.win,
      gameDuration: matches.gameDuration,
      gameStart: matches.gameStart,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .where(
      and(
        notRemakeCond(),
        gte(matches.gameStart, startMs),
        lt(matches.gameStart, endMs),
      ),
    )
    .all();

  // Team kills per (matchId, teamId) for KP — compute over ALL participants in
  // those matches, not just tracked friends, so KP is correct on stacked
  // games where multiple friends share a team.
  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  const teamKillsByMatch = new Map<string, Map<number, number>>();
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

  const byPuuid = new Map<string, DailyPlayerStat>();
  for (const r of rows) {
    let s = byPuuid.get(r.puuid);
    if (!s) {
      s = {
        puuid: r.puuid,
        displayName: r.displayName ?? r.gameName,
        games: 0,
        wins: 0,
        losses: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        totalDamage: 0,
        totalGold: 0,
        totalCs: 0,
        totalDuration: 0,
        totalVision: 0,
        totalWardsPlaced: 0,
        totalWardsKilled: 0,
        totalControlWards: 0,
        totalTimeDead: 0,
        kpSum: 0,
        firstBloodKills: 0,
        firstBloodAssists: 0,
        firstTowerKills: 0,
        pentaKills: 0,
        quadraKills: 0,
        tripleKills: 0,
        doubleKills: 0,
        dragonKills: 0,
        baronKills: 0,
        turretKills: 0,
        objectivesStolen: 0,
        ownTeamFF: 0,
        enemyFF: 0,
        mvpScoreSum: 0,
      };
      byPuuid.set(r.puuid, s);
    }
    const tk = teamKillsByMatch.get(r.matchId)?.get(r.teamId) ?? 0;
    const kp = tk > 0 ? (r.kills + r.assists) / tk : 0;
    const damage = r.damage ?? 0;
    const vision = r.vision ?? 0;
    const gold = r.gold ?? 0;
    const cs = (r.totalMinionsKilled ?? 0) + (r.neutralMinionsKilled ?? 0);
    s.games += 1;
    if (r.win) s.wins += 1;
    else s.losses += 1;
    s.totalKills += r.kills;
    s.totalDeaths += r.deaths;
    s.totalAssists += r.assists;
    s.totalDamage += damage;
    s.totalGold += gold;
    s.totalCs += cs;
    s.totalDuration += r.gameDuration;
    s.totalVision += vision;
    s.totalWardsPlaced += r.wardsPlaced ?? 0;
    s.totalWardsKilled += r.wardsKilled ?? 0;
    s.totalControlWards += r.controlWards ?? 0;
    s.totalTimeDead += r.timeDead ?? 0;
    s.kpSum += kp;
    if (r.firstBloodKill) s.firstBloodKills += 1;
    if (r.firstBloodAssist) s.firstBloodAssists += 1;
    if (r.firstTowerKill) s.firstTowerKills += 1;
    s.pentaKills += r.pentaKills ?? 0;
    s.quadraKills += r.quadraKills ?? 0;
    s.tripleKills += r.tripleKills ?? 0;
    s.doubleKills += r.doubleKills ?? 0;
    s.dragonKills += r.dragonKills ?? 0;
    s.baronKills += r.baronKills ?? 0;
    s.turretKills += r.turretKills ?? 0;
    s.objectivesStolen += r.objectivesStolen ?? 0;
    if (r.gameEndedInSurrender) {
      if (r.win) s.enemyFF += 1;
      else s.ownTeamFF += 1;
    }
    s.mvpScoreSum += gatsbyScore({
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      damage,
      damageTaken: r.damageTaken ?? 0,
      damageToBuildings: r.damageToBuildings ?? 0,
      vision,
      dragons: r.dragonKills ?? 0,
      barons: r.baronKills ?? 0,
      turrets: r.turretKills ?? 0,
      win: r.win,
      kp,
      teamPosition: r.teamPosition,
    });
  }

  const stats = [...byPuuid.values()].sort(
    (a, b) => b.mvpScoreSum / Math.max(1, b.games) - a.mvpScoreSum / Math.max(1, a.games),
  );

  // Reuse the existing party grouping logic for rendering match cards.
  const parties = queryParties(db, { sinceMs: startMs, untilMs: endMs, limit: 200 });

  return {
    dayKey: dayKeyOf(startMs),
    dayMs: startMs,
    prevDayMs,
    nextDayMs,
    stats,
    totalMatches: matchIds.length,
    parties,
  };
}
