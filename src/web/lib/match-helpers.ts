import type { Match, MatchParticipant, MatchTimeline } from "../../riot/types.js";

export function participantByPuuid(match: Match, puuid: string): MatchParticipant | undefined {
  return match.info.participants.find((p) => p.puuid === puuid);
}

export function teamParticipants(match: Match, teamId: number): MatchParticipant[] {
  return match.info.participants.filter((p) => p.teamId === teamId);
}

export function teamKills(participants: MatchParticipant[]): number {
  return participants.reduce((sum, p) => sum + (p.kills ?? 0), 0);
}

export function kpPercent(p: MatchParticipant, teamMembers: MatchParticipant[]): number {
  const tk = teamKills(teamMembers);
  if (tk === 0) return 0;
  return Math.round((((p.kills ?? 0) + (p.assists ?? 0)) / tk) * 100);
}

export function csOf(p: MatchParticipant): number {
  return (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
}

export interface TeamSummary {
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage: number;
  towers: number;
  dragons: number;
  barons: number;
  inhibitors: number;
  heralds: number;
  bans: number[];
}

export function summarizeTeam(match: Match, teamId: number): TeamSummary {
  const members = teamParticipants(match, teamId);
  const team = match.info.teams?.find((t) => t.teamId === teamId);
  const obj = team?.objectives ?? {};
  return {
    teamId,
    win: members[0]?.win ?? false,
    kills: members.reduce((s, p) => s + (p.kills ?? 0), 0),
    deaths: members.reduce((s, p) => s + (p.deaths ?? 0), 0),
    assists: members.reduce((s, p) => s + (p.assists ?? 0), 0),
    gold: members.reduce((s, p) => s + (p.goldEarned ?? 0), 0),
    damage: members.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0),
    towers: obj.tower?.kills ?? 0,
    dragons: obj.dragon?.kills ?? 0,
    barons: obj.baron?.kills ?? 0,
    inhibitors: obj.inhibitor?.kills ?? 0,
    heralds: obj.riftHerald?.kills ?? 0,
    bans: team?.bans.map((b) => b.championId) ?? [],
  };
}

export interface TimelineFrame {
  timestamp: number;
  participantFrames: Record<string, { participantId: number; totalGold?: number }>;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  type: string;
  timestamp: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  teamId?: number;
  killerTeamId?: number;
  towerType?: string;
  buildingType?: string;
  laneType?: string;
  monsterType?: string;
  monsterSubType?: string;
  wardType?: string;
  creatorId?: number;
  name?: string;
}

export function timelineFrames(timeline: MatchTimeline): TimelineFrame[] {
  return timeline.info.frames as TimelineFrame[];
}

export interface GoldFrame {
  minute: number;
  delta: number;
  blueGold: number;
  redGold: number;
}

export function goldByMinute(match: Match, timeline: MatchTimeline): GoldFrame[] {
  const pidToTeam = new Map<number, number>();
  const tlParticipants = (timeline.info.participants ?? []) as Array<{
    participantId: number;
    puuid: string;
  }>;
  for (const tp of tlParticipants) {
    const mp = match.info.participants.find((p) => p.puuid === tp.puuid);
    if (mp) pidToTeam.set(tp.participantId, mp.teamId);
  }

  const frames = timelineFrames(timeline);
  return frames.map((frame, idx) => {
    let blue = 0;
    let red = 0;
    for (const [pid, pf] of Object.entries(frame.participantFrames)) {
      const team = pidToTeam.get(pf.participantId ?? Number(pid));
      const gold = pf.totalGold ?? 0;
      if (team === 100) blue += gold;
      else if (team === 200) red += gold;
    }
    return { minute: idx, blueGold: blue, redGold: red, delta: blue - red };
  });
}

export function championByParticipantId(match: Match, pid: number): MatchParticipant | undefined {
  return match.info.participants.find((p) => p.participantId === pid);
}

export interface ScoreBreakdown {
  kda: number;
  damage: number;
  killParticipation: number;
  vision: number;
  towerDamage: number;
  healing: number;
  shielding: number;
  tanking: number;
  victory: number;
  total: number;
}

export interface ParticipantScore {
  puuid: string;
  teamId: number;
  breakdown: ScoreBreakdown;
}

const num = (n: number | undefined | null): number => (typeof n === "number" ? n : 0);

export function participantScores(match: Match): Map<string, ParticipantScore> {
  const participants = match.info.participants;
  const maxOf = (pick: (p: MatchParticipant) => number): number =>
    Math.max(1, ...participants.map(pick));

  const maxDmg = maxOf((p) => num(p.totalDamageDealtToChampions));
  const maxVision = maxOf((p) => num(p.visionScore));
  const maxTower = maxOf((p) => num(p.damageDealtToTurrets));
  const maxHeal = maxOf((p) => num(p.totalHealsOnTeammates));
  const maxShield = maxOf((p) =>
    num((p as MatchParticipant & { totalDamageShieldedOnTeammates?: number }).totalDamageShieldedOnTeammates),
  );
  const maxTank = maxOf((p) => num(p.totalDamageTaken));

  const teamKills = new Map<number, number>();
  for (const p of participants) {
    teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + num(p.kills));
  }

  const result = new Map<string, ParticipantScore>();
  for (const p of participants) {
    const deaths = Math.max(1, num(p.deaths));
    const kdaRatio = (num(p.kills) + num(p.assists)) / deaths;
    const kda = Math.min(20, kdaRatio * 2);
    const damage = (num(p.totalDamageDealtToChampions) / maxDmg) * 25;
    const tk = teamKills.get(p.teamId) ?? 0;
    const killParticipation =
      tk === 0 ? 0 : Math.min(25, ((num(p.kills) + num(p.assists)) / tk) * 25);
    const vision = (num(p.visionScore) / maxVision) * 10;
    const towerDamage = (num(p.damageDealtToTurrets) / maxTower) * 7;
    const healing = (num(p.totalHealsOnTeammates) / maxHeal) * 5;
    const shielding =
      (num((p as MatchParticipant & { totalDamageShieldedOnTeammates?: number }).totalDamageShieldedOnTeammates) /
        maxShield) *
      5;
    const tanking = (num(p.totalDamageTaken) / maxTank) * 5;
    const victory = p.win ? 5 : 0;
    const total = kda + damage + killParticipation + vision + towerDamage + healing + shielding + tanking + victory;
    result.set(p.puuid, {
      puuid: p.puuid,
      teamId: p.teamId,
      breakdown: {
        kda,
        damage,
        killParticipation,
        vision,
        towerDamage,
        healing,
        shielding,
        tanking,
        victory,
        total,
      },
    });
  }
  return result;
}

export interface MatchRanking {
  ordered: ParticipantScore[];
  placement: Map<string, number>;
}

export function rankMatch(scores: Map<string, ParticipantScore>): MatchRanking {
  const ordered = [...scores.values()].sort((a, b) => b.breakdown.total - a.breakdown.total);
  const placement = new Map<string, number>();
  ordered.forEach((s, i) => placement.set(s.puuid, i + 1));
  return { ordered, placement };
}

export function fmtClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const DRAGON_LABEL: Record<string, string> = {
  AIR_DRAGON: "Cloud Drake",
  FIRE_DRAGON: "Infernal Drake",
  WATER_DRAGON: "Ocean Drake",
  EARTH_DRAGON: "Mountain Drake",
  HEXTECH_DRAGON: "Hextech Drake",
  CHEMTECH_DRAGON: "Chemtech Drake",
  ELDER_DRAGON: "Elder Dragon",
};

const LANE_LABEL: Record<string, string> = {
  TOP_LANE: "Top",
  MID_LANE: "Mid",
  BOT_LANE: "Bot",
};

const TURRET_LABEL: Record<string, string> = {
  OUTER_TURRET: "Outer Turret",
  INNER_TURRET: "Inner Turret",
  BASE_TURRET: "Inhibitor Turret",
  NEXUS_TURRET: "Nexus Turret",
};

const TEAM_LABEL: Record<number, string> = { 100: "Blue", 200: "Red" };

export interface RenderableEvent {
  timestamp: number;
  kind: "kill" | "objective" | "building" | "plate" | "soul";
  actorTeamId: number | undefined;
  actorChampion: string | undefined;
  victimChampion: string | undefined;
  assistChampions: string[];
  text: string;
}

export function renderableEvents(match: Match, timeline: MatchTimeline): RenderableEvent[] {
  const out: RenderableEvent[] = [];
  for (const frame of timelineFrames(timeline)) {
    for (const ev of frame.events) {
      const r = renderEvent(ev, match);
      if (r) out.push(r);
    }
  }
  return out;
}

function renderEvent(ev: TimelineEvent, match: Match): RenderableEvent | undefined {
  switch (ev.type) {
    case "CHAMPION_KILL": {
      const killer = ev.killerId ? championByParticipantId(match, ev.killerId) : undefined;
      const victim = ev.victimId ? championByParticipantId(match, ev.victimId) : undefined;
      if (!victim) return undefined;
      const assists = (ev.assistingParticipantIds ?? [])
        .map((id) => championByParticipantId(match, id)?.championName)
        .filter((x): x is string => Boolean(x));
      const killerName = killer?.championName ?? "Execute";
      const verb = killer ? "killed" : "executed";
      const tail = assists.length > 0 ? ` (assists: ${assists.join(", ")})` : "";
      return {
        timestamp: ev.timestamp,
        kind: "kill",
        actorTeamId: killer?.teamId,
        actorChampion: killer?.championName,
        victimChampion: victim.championName,
        assistChampions: assists,
        text: `${killerName} ${verb} ${victim.championName}${tail}`,
      };
    }
    case "BUILDING_KILL": {
      const team = ev.teamId === 100 ? 200 : 100;
      const teamName = TEAM_LABEL[team] ?? "Team";
      if (ev.buildingType === "INHIBITOR_BUILDING") {
        return {
          timestamp: ev.timestamp,
          kind: "building",
          actorTeamId: team,
          actorChampion: undefined,
          victimChampion: undefined,
          assistChampions: [],
          text: `${teamName} destroyed an Inhibitor (${LANE_LABEL[ev.laneType ?? ""] ?? ev.laneType ?? "?"})`,
        };
      }
      const turret = TURRET_LABEL[ev.towerType ?? ""] ?? "Turret";
      return {
        timestamp: ev.timestamp,
        kind: "building",
        actorTeamId: team,
        actorChampion: undefined,
        victimChampion: undefined,
        assistChampions: [],
        text: `${teamName} destroyed a ${turret} (${LANE_LABEL[ev.laneType ?? ""] ?? ev.laneType ?? "?"})`,
      };
    }
    case "TURRET_PLATE_DESTROYED": {
      const team = ev.teamId === 100 ? 200 : 100;
      const teamName = TEAM_LABEL[team] ?? "Team";
      return {
        timestamp: ev.timestamp,
        kind: "plate",
        actorTeamId: team,
        actorChampion: undefined,
        victimChampion: undefined,
        assistChampions: [],
        text: `${teamName} broke a Turret Plate (${LANE_LABEL[ev.laneType ?? ""] ?? ev.laneType ?? "?"})`,
      };
    }
    case "ELITE_MONSTER_KILL": {
      const team = ev.killerTeamId;
      const teamName = team ? TEAM_LABEL[team] ?? "Team" : "Team";
      const killer = ev.killerId ? championByParticipantId(match, ev.killerId) : undefined;
      let monster = "Objective";
      if (ev.monsterType === "DRAGON") monster = DRAGON_LABEL[ev.monsterSubType ?? ""] ?? "Dragon";
      else if (ev.monsterType === "BARON_NASHOR") monster = "Baron Nashor";
      else if (ev.monsterType === "RIFTHERALD") monster = "Rift Herald";
      else if (ev.monsterType === "HORDE") monster = "Voidgrub";
      else if (ev.monsterType === "ATAKHAN") monster = "Atakhan";
      return {
        timestamp: ev.timestamp,
        kind: "objective",
        actorTeamId: team,
        actorChampion: killer?.championName,
        victimChampion: undefined,
        assistChampions: [],
        text: `${teamName} killed ${monster}${killer ? ` (${killer.championName})` : ""}`,
      };
    }
    case "DRAGON_SOUL_GIVEN": {
      const teamName = ev.teamId ? TEAM_LABEL[ev.teamId] ?? "Team" : "Team";
      return {
        timestamp: ev.timestamp,
        kind: "soul",
        actorTeamId: ev.teamId,
        actorChampion: undefined,
        victimChampion: undefined,
        assistChampions: [],
        text: `${teamName} claimed ${ev.name ?? "Dragon"} Soul`,
      };
    }
    default:
      return undefined;
  }
}
