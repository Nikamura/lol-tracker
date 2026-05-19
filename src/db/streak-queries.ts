import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "./connect.js";
import { notRemakeCond } from "./match-filters.js";
import { matchParticipants, matches, players } from "./schema.js";

export interface StreakCurrent {
  sign: "W" | "L" | "-";
  length: number;
}

export interface Last10Game {
  win: boolean;
  gameStart: number;
  opponentChampion: string | null;
}

export interface PlayerStreaks {
  puuid: string;
  displayName: string;
  current: StreakCurrent;
  longestW: number;
  longestL: number;
  last10: Last10Game[];
  last10AvgKda: number;
  last10Wins: number;
  last10Losses: number;
  lateNightCount: number;
  totalGames: number;
  tilt: boolean;
  hot: boolean;
}

export interface StreaksOptions {
  sinceMs?: number;
  queueIds?: number[];
}

export interface StreaksData {
  players: PlayerStreaks[];
}

interface PlayerMatchRow {
  puuid: string;
  matchId: string;
  gameStart: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  teamId: number;
  teamPosition: string | null;
}

interface OpponentRow {
  matchId: string;
  teamId: number;
  teamPosition: string | null;
  championName: string;
}

function isLateNight(ms: number): boolean {
  const hour = new Date(ms).getHours();
  return hour >= 22 || hour < 5;
}

function computeCurrent(games: PlayerMatchRow[]): StreakCurrent {
  if (games.length === 0) return { sign: "-", length: 0 };
  const first = games[0];
  if (!first) return { sign: "-", length: 0 };
  const sign: "W" | "L" = first.win ? "W" : "L";
  let length = 0;
  for (const g of games) {
    if (g.win === first.win) length += 1;
    else break;
  }
  return { sign, length };
}

function computeLongest(
  games: PlayerMatchRow[],
  predicate: (g: PlayerMatchRow) => boolean,
): number {
  let longest = 0;
  let run = 0;
  for (const g of games) {
    if (predicate(g)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

function buildOpponentKey(matchId: string, teamId: number, teamPosition: string | null): string {
  return `${matchId}|${teamId}|${teamPosition ?? ""}`;
}

function pickOpponentChampion(
  game: PlayerMatchRow,
  opponentsByMatch: Map<string, OpponentRow[]>,
): string | null {
  const opponents = opponentsByMatch.get(game.matchId);
  if (!opponents || opponents.length === 0) return null;
  const enemyTeam = game.teamId === 100 ? 200 : 100;
  if (game.teamPosition) {
    const match = opponents.find(
      (o) => o.teamId === enemyTeam && o.teamPosition === game.teamPosition,
    );
    if (match) return match.championName;
  }
  return opponents.find((o) => o.teamId === enemyTeam)?.championName ?? null;
}

export function streaksForAll(db: DB, opts: StreaksOptions = {}): StreaksData {
  const trackedPlayers = db
    .select({
      puuid: players.puuid,
      gameName: players.gameName,
      displayName: players.displayName,
    })
    .from(players)
    .orderBy(asc(players.displayName), asc(players.gameName))
    .all();

  if (trackedPlayers.length === 0) {
    return { players: [] };
  }

  const puuids = trackedPlayers.map((p) => p.puuid);

  const conds = [inArray(matchParticipants.puuid, puuids), notRemakeCond()];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const rows = db
    .select({
      puuid: matchParticipants.puuid,
      matchId: matchParticipants.matchId,
      gameStart: matches.gameStart,
      win: matchParticipants.win,
      kills: matchParticipants.kills,
      deaths: matchParticipants.deaths,
      assists: matchParticipants.assists,
      teamId: matchParticipants.teamId,
      teamPosition: matchParticipants.teamPosition,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .where(and(...conds))
    .orderBy(desc(matches.gameStart))
    .all();

  const byPuuid = new Map<string, PlayerMatchRow[]>();
  for (const row of rows) {
    let list = byPuuid.get(row.puuid);
    if (!list) {
      list = [];
      byPuuid.set(row.puuid, list);
    }
    list.push(row);
  }

  // Look up opponent champions for the unique set of matches across last-10 buckets only.
  const last10MatchIds = new Set<string>();
  for (const list of byPuuid.values()) {
    for (let i = 0; i < Math.min(10, list.length); i += 1) {
      const row = list[i];
      if (row) last10MatchIds.add(row.matchId);
    }
  }

  const opponentsByMatch = new Map<string, OpponentRow[]>();
  if (last10MatchIds.size > 0) {
    const matchIds = [...last10MatchIds];
    const oppRows = db
      .select({
        matchId: matchParticipants.matchId,
        teamId: matchParticipants.teamId,
        teamPosition: matchParticipants.teamPosition,
        championName: matchParticipants.championName,
      })
      .from(matchParticipants)
      .where(inArray(matchParticipants.matchId, matchIds))
      .all();
    for (const o of oppRows) {
      let list = opponentsByMatch.get(o.matchId);
      if (!list) {
        list = [];
        opponentsByMatch.set(o.matchId, list);
      }
      list.push(o);
    }
  }

  const result: PlayerStreaks[] = trackedPlayers.map((p) => {
    const display = p.displayName ?? p.gameName;
    const games = byPuuid.get(p.puuid) ?? [];

    const current = computeCurrent(games);
    const longestW = computeLongest(games, (g) => g.win);
    const longestL = computeLongest(games, (g) => !g.win);

    const recent = games.slice(0, 10); // newest -> oldest
    const last10Wins = recent.filter((g) => g.win).length;
    const last10Losses = recent.length - last10Wins;

    const kdaSum = recent.reduce(
      (acc, g) => acc + (g.kills + g.assists) / Math.max(1, g.deaths),
      0,
    );
    const last10AvgKda = recent.length === 0 ? 0 : kdaSum / recent.length;

    const lateNightCount = games.filter((g) => isLateNight(g.gameStart)).length;

    const last10: Last10Game[] = [...recent].reverse().map((g) => ({
      win: g.win,
      gameStart: g.gameStart,
      opponentChampion: pickOpponentChampion(g, opponentsByMatch),
    }));

    const enoughGames = recent.length >= 5;
    const winrate = recent.length > 0 ? last10Wins / recent.length : 0;
    const tilt =
      enoughGames &&
      current.sign === "L" &&
      current.length >= 3 &&
      winrate <= 0.4 &&
      last10AvgKda < 1.5;
    const hot =
      enoughGames &&
      current.sign === "W" &&
      current.length >= 3 &&
      winrate >= 0.6;

    return {
      puuid: p.puuid,
      displayName: display,
      current,
      longestW,
      longestL,
      last10,
      last10AvgKda,
      last10Wins,
      last10Losses,
      lateNightCount,
      totalGames: games.length,
      tilt,
      hot,
    };
  });

  result.sort((a, b) => {
    if (a.tilt !== b.tilt) return a.tilt ? -1 : 1;
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    if (a.totalGames === 0 && b.totalGames > 0) return 1;
    if (b.totalGames === 0 && a.totalGames > 0) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  return { players: result };
}
