import { renderableEvents } from "./match-helpers.js";
import type { Match, MatchTimeline } from "../../riot/types.js";

export const GRAPH_METRICS = [
  { key: "damage", label: "Damage dealt", description: "Cumulative damage dealt to champions." },
  { key: "taken", label: "Damage taken", description: "Cumulative damage taken from all sources." },
  { key: "cs", label: "CS", description: "Lane minions and jungle monsters killed." },
  { key: "gold", label: "Gold", description: "Total gold earned, including starting gold." },
  { key: "level", label: "Level", description: "Champion level at each recorded sample; changes between samples are not exact level-up times." },
  { key: "xp", label: "XP", description: "Total experience earned." },
  { key: "teamGold", label: "Team gold lead", description: "Blue team gold minus red team gold. Above zero: blue ahead. Below zero: red ahead." },
] as const;

export type GraphMetric = (typeof GRAPH_METRICS)[number]["key"];
export type ChampionMetric = Exclude<GraphMetric, "teamGold">;
export interface GraphPlayer {
  id: number;
  teamId: number;
  name: string;
  champion: string;
  tracked: boolean;
  role: string;
  color: string;
  values: Record<ChampionMetric, Array<number | null>>;
}
export interface MatchGraphData {
  timestamps: number[];
  players: GraphPlayer[];
  teamGold: Array<number | null>;
  moments: Array<{timestamp: number; text: string; actorChampion?: string | undefined; kind: string; teamId: number | null}>;
}

const BLUE = ["#38bdf8", "#818cf8", "#2dd4bf", "#a5b4fc", "#67e8f9"];
const RED = ["#fb7185", "#fbbf24", "#e879f9", "#fb923c", "#fda4af"];
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Read only observed values. Missing fields stay null, never fabricated zeroes. */
export function matchGraphData(
  match: Match,
  timeline: MatchTimeline,
  trackedNames: Map<string, string>,
): MatchGraphData {
  const frames = timeline.info.frames.map(record)
    .filter((f) => number(f.timestamp) !== null)
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  const teamCounts = new Map<number, number>();
  const players: GraphPlayer[] = [];
  for (const p of match.info.participants) {
    // Match participant IDs survive PUUID key rotation and don't rely on array order.
    const id = number(p.participantId)
      ?? timeline.info.participants?.find((tp) => tp.puuid === p.puuid)?.participantId;
    if (!id) continue;
    const index = teamCounts.get(p.teamId) ?? 0;
    teamCounts.set(p.teamId, index + 1);
    const values: GraphPlayer["values"] = { damage: [], taken: [], cs: [], gold: [], level: [], xp: [] };
    for (const frame of frames) {
      const snapshots = record(frame.participantFrames);
      const snapshot = record(snapshots[String(id)] ?? Object.values(snapshots)
        .find((pf) => record(pf).participantId === id));
      const damage = record(snapshot.damageStats);
      const lane = number(snapshot.minionsKilled);
      const jungle = number(snapshot.jungleMinionsKilled);
      values.damage.push(number(damage.totalDamageDoneToChampions));
      values.taken.push(number(damage.totalDamageTaken));
      values.cs.push(lane === null || jungle === null ? null : lane + jungle);
      values.gold.push(number(snapshot.totalGold));
      values.level.push(number(snapshot.level));
      values.xp.push(number(snapshot.xp));
    }
    players.push({
      id, teamId: p.teamId, champion: p.championName,
      name: trackedNames.get(p.puuid) ?? p.riotIdGameName ?? p.summonerName ?? p.championName,
      tracked: trackedNames.has(p.puuid), role: p.teamPosition ?? "",
      color: (p.teamId === 100 ? BLUE : RED)[index % 5]!, values,
    });
  }
  function total(teamId: number, index: number): number | null {
    const team = players.filter((p) => p.teamId === teamId);
    const expected = match.info.participants.filter((p) => p.teamId === teamId).length;
    if (!team.length || team.length !== expected) return null;
    const values = team.map((p) => p.values.gold[index]);
    return values.some((v) => v == null) ? null : values.reduce<number>((sum, v) => sum + v!, 0);
  }
  return {
    timestamps: frames.map((f) => f.timestamp as number), players,
    moments: renderableEvents(match, {
      ...timeline, info: {...timeline.info, frames: frames.map(f=>({...f, events:Array.isArray(f.events)?f.events.filter(e=>e && typeof e==='object' && typeof e.type==='string' && Number.isFinite(e.timestamp)):[]}))},
    }).filter((event, index, events) =>
      event.kind === 'objective' || event.kind === 'building'
      || (event.kind === 'kill' && event.actorChampion && !events.slice(0,index).some(e=>e.kind==='kill' && e.actorChampion)))
      .map(e=>({timestamp:e.timestamp, text:e.kind==='kill'?`First kill: ${e.text}`:e.text, kind:e.kind, actorChampion:e.actorChampion, teamId:e.actorTeamId??null})),
    teamGold: frames.map((_, i) => {
      const blue = total(100, i), red = total(200, i);
      return blue === null || red === null ? null : blue - red;
    }),
  };
}
