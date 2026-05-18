import { and, asc, eq, gte, inArray, type SQL } from "drizzle-orm";
import type { DB } from "./connect.js";
import { matchParticipants, matches, players } from "./schema.js";

/**
 * One non-empty heatmap cell: a (day-of-week, hour-of-day) bucket together with
 * games played and wins recorded in that slot.
 */
export interface Cell {
  /** 0 = Monday, 6 = Sunday (ISO order). */
  dayIdx: number;
  /** 0..23, hour-of-day in server local time. */
  hour: number;
  games: number;
  wins: number;
}

export interface PlayerHeatmap {
  puuid: string;
  displayName: string;
  cells: Cell[];
  maxGames: number;
}

export interface AggregateHeatmap {
  cells: Cell[];
  maxGames: number;
}

export interface HeatmapsData {
  aggregate: AggregateHeatmap;
  perPlayer: PlayerHeatmap[];
}

export interface HeatmapsOptions {
  sinceMs?: number;
  queueIds?: number[];
}

/**
 * Walk every tracked-player match in range, then bucket each game into a
 * (player, dayIdx, hour) cell. Aggregation is done in JS so we can reuse the
 * server-local timezone the rest of the app already uses (and avoid teaching
 * SQLite about it).
 */
export function heatmapData(db: DB, opts: HeatmapsOptions = {}): HeatmapsData {
  const conds: SQL[] = [];
  if (opts.sinceMs !== undefined) conds.push(gte(matches.gameStart, opts.sinceMs));
  if (opts.queueIds?.length) conds.push(inArray(matches.queueId, opts.queueIds));

  const base = db
    .select({
      puuid: matchParticipants.puuid,
      displayName: players.displayName,
      gameName: players.gameName,
      gameStart: matches.gameStart,
      win: matchParticipants.win,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.matchId, matchParticipants.matchId))
    .innerJoin(players, eq(players.puuid, matchParticipants.puuid))
    .orderBy(asc(players.displayName), asc(players.gameName));

  const rows = conds.length ? base.where(and(...conds)).all() : base.all();

  // Bucket key: `${dayIdx}|${hour}`. One bucket map per player and one for the
  // aggregate; both share the same key shape so the UI walks them identically.
  interface Bucket {
    games: number;
    wins: number;
  }

  interface PlayerAccumulator {
    puuid: string;
    displayName: string;
    buckets: Map<string, Bucket>;
  }

  const perPlayer = new Map<string, PlayerAccumulator>();
  const aggregateBuckets = new Map<string, Bucket>();

  for (const r of rows) {
    const d = new Date(r.gameStart);
    const jsDay = d.getDay();
    const dayIdx = (jsDay + 6) % 7;
    const hour = d.getHours();
    const key = `${dayIdx}|${hour}`;

    const aggBucket = aggregateBuckets.get(key) ?? { games: 0, wins: 0 };
    aggBucket.games += 1;
    if (r.win) aggBucket.wins += 1;
    aggregateBuckets.set(key, aggBucket);

    let acc = perPlayer.get(r.puuid);
    if (!acc) {
      acc = {
        puuid: r.puuid,
        displayName: r.displayName ?? r.gameName,
        buckets: new Map(),
      };
      perPlayer.set(r.puuid, acc);
    }
    const pBucket = acc.buckets.get(key) ?? { games: 0, wins: 0 };
    pBucket.games += 1;
    if (r.win) pBucket.wins += 1;
    acc.buckets.set(key, pBucket);
  }

  const toCells = (buckets: Map<string, Bucket>): { cells: Cell[]; maxGames: number } => {
    const cells: Cell[] = [];
    let maxGames = 0;
    for (const [key, bucket] of buckets) {
      const [dayStr, hourStr] = key.split("|");
      const dayIdx = Number(dayStr);
      const hour = Number(hourStr);
      cells.push({ dayIdx, hour, games: bucket.games, wins: bucket.wins });
      if (bucket.games > maxGames) maxGames = bucket.games;
    }
    return { cells, maxGames };
  };

  const playerList = [...perPlayer.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map<PlayerHeatmap>((acc) => {
      const { cells, maxGames } = toCells(acc.buckets);
      return {
        puuid: acc.puuid,
        displayName: acc.displayName,
        cells,
        maxGames,
      };
    });

  const { cells: aggCells, maxGames: aggMax } = toCells(aggregateBuckets);

  return {
    aggregate: { cells: aggCells, maxGames: aggMax },
    perPlayer: playerList,
  };
}
