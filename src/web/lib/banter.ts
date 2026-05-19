import type {
  ChampionAffairData,
  CrownEntry,
  DamageProfileRow,
  DurationRow,
  FirstBloodRow,
  HourlySeries,
  LaneRow,
  Lane,
  MultiKillRow,
  ObjectiveRow,
  RadarData,
  RankRaceData,
  ScatterSeries,
  SurrenderRow,
  VisionRow,
  WeekdayRow,
} from "../../db/comparison-queries.js";
import { WEEKDAYS } from "../../db/comparison-queries.js";

export interface Banter {
  headline: string;
  subtitle: string;
}

const SHRUG: Banter = {
  headline: "The pavilion is hushed, old sport.",
  subtitle: "Not enough data yet — play more games to summon the orchestra.",
};

function pickHighLow<T extends object>(
  rows: T[],
  get: (r: T) => number,
): { high: T; low: T } | null {
  if (rows.length < 2) return null;
  let high: T = rows[0]!;
  let low: T = rows[0]!;
  for (const r of rows) {
    if (get(r) > get(high)) high = r;
    if (get(r) < get(low)) low = r;
  }
  if (high === low) return null;
  return { high, low };
}

export function rankRaceBanter(d: RankRaceData): Banter {
  if (d.series.length === 0) return SHRUG;
  const climber = d.series[0]!;
  const faller = d.series[d.series.length - 1]!;
  if (climber.delta === 0 && faller.delta === 0) {
    return {
      headline: "An evening of polite stalemate.",
      subtitle: "No one moved a muscle on the ladder. How very dignified.",
    };
  }
  return {
    headline: `${climber.displayName} ascends ${Math.round(climber.delta)} LP.`,
    subtitle:
      climber === faller
        ? "A solo waltz across the ballroom — no rival in sight."
        : `Meanwhile ${faller.displayName} slid ${Math.abs(Math.round(faller.delta))} LP. Less green light, old sport, more wards.`,
  };
}

export function radarBanter(d: RadarData): Banter {
  if (d.players.length < 2) return SHRUG;
  // Find player with biggest aggregate normalized advantage
  const totals = d.players.map((p) => ({
    p,
    total: p.norm.reduce((a, b) => a + b, 0),
  }));
  totals.sort((a, b) => b.total - a.total);
  const top = totals[0]!.p;
  const bottom = totals[totals.length - 1]!.p;
  return {
    headline: `${top.displayName} casts the longest shadow.`,
    subtitle: `Across eight axes, ${top.displayName} outshines ${bottom.displayName} — every gala has its Gatsby and its Wilson.`,
  };
}

export function championAffairBanter(d: ChampionAffairData): Banter {
  if (d.cells.length === 0) return SHRUG;
  // worst winrate champion with >= 5 games
  const offenders = d.cells.filter((c) => c.games >= 5);
  if (offenders.length === 0) return SHRUG;
  offenders.sort((a, b) => a.winrate - b.winrate);
  const worst = offenders[0]!;
  const best = offenders[offenders.length - 1]!;
  const nameOf = (puuid: string) =>
    d.players.find((p) => p.puuid === puuid)?.displayName ?? "Someone";
  return {
    headline: `${nameOf(worst.puuid)} keeps a torch lit for ${worst.championName}.`,
    subtitle: `${(worst.winrate * 100).toFixed(0)}% over ${worst.games} games — a love that does not love them back. Meanwhile ${nameOf(best.puuid)} polishes ${best.championName} at ${(best.winrate * 100).toFixed(0)}%.`,
  };
}

const LANE_TITLES: Record<Lane, string> = {
  TOP: "King of the Hilltop",
  JUNGLE: "Lord of the Thicket",
  MIDDLE: "Sovereign of the Centre",
  BOTTOM: "Duke of the Bottom",
  UTILITY: "Patron of the Wards",
};

export function laneBanter(rows: LaneRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  let best: { row: LaneRow; lane: Lane; wr: number; games: number } | null = null;
  let worst: { row: LaneRow; lane: Lane; wr: number; games: number } | null = null;
  for (const r of rows) {
    for (const lane of Object.keys(r.byLane) as Lane[]) {
      const cell = r.byLane[lane];
      if (cell.games < 5) continue;
      if (!best || cell.winrate > best.wr) best = { row: r, lane, wr: cell.winrate, games: cell.games };
      if (!worst || cell.winrate < worst.wr) worst = { row: r, lane, wr: cell.winrate, games: cell.games };
    }
  }
  if (!best || !worst) return SHRUG;
  return {
    headline: `${best.row.displayName}: ${LANE_TITLES[best.lane]}.`,
    subtitle: `${(best.wr * 100).toFixed(0)}% in ${best.lane} (${best.games}g). Meanwhile ${worst.row.displayName} pretends to play ${worst.lane} at ${(worst.wr * 100).toFixed(0)}% — perhaps a tactical retreat to the buffet table.`,
  };
}

export function goldCurveBanter(series: ScatterSeries[]): Banter {
  if (series.length === 0) return SHRUG;
  // For each series, compute median gpm and dpm
  const summary = series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const meanG = s.points.reduce((a, p) => a + p.gpm, 0) / s.points.length;
      const meanD = s.points.reduce((a, p) => a + p.dpm, 0) / s.points.length;
      return { name: s.displayName, gpm: meanG, dpm: meanD, ratio: meanD / Math.max(1, meanG) };
    });
  if (summary.length === 0) return SHRUG;
  summary.sort((a, b) => b.ratio - a.ratio);
  const swordsman = summary[0]!;
  const hoarder = summary[summary.length - 1]!;
  if (swordsman === hoarder) return SHRUG;
  return {
    headline: `${swordsman.name} sells the suit, swings the sword.`,
    subtitle: `Every gold piece becomes ${swordsman.ratio.toFixed(2)} damage — while ${hoarder.name} hoards coin and spends it on fireworks (${hoarder.ratio.toFixed(2)}).`,
  };
}

export function visionBanter(rows: VisionRow[]): Banter {
  const pick = pickHighLow(rows.filter((r) => r.games >= 5), (r) => r.visionScore);
  if (!pick) return SHRUG;
  return {
    headline: `${pick.high.displayName}: Most Illuminated Mind.`,
    subtitle: `Vision score ${pick.high.visionScore.toFixed(1)} per game — twice the candlelight of ${pick.low.displayName} (${pick.low.visionScore.toFixed(1)}), who prefers the shadows.`,
  };
}

export function pentakillBanter(rows: MultiKillRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  const withPentas = rows.filter((r) => r.pentaKills > 0);
  if (withPentas.length > 0) {
    withPentas.sort((a, b) => b.pentaKills - a.pentaKills);
    const top = withPentas[0]!;
    return {
      headline: `${top.displayName}: ${top.pentaKills} pentakill${top.pentaKills > 1 ? "s" : ""} in the dossier.`,
      subtitle: `We have not forgotten, old sport. The orchestra plays in your honour.`,
    };
  }
  // Best quadra
  const sorted = [...rows].sort((a, b) => b.quadraKills - a.quadraKills);
  const top = sorted[0]!;
  if (top.quadraKills === 0) {
    return {
      headline: "No pentakills. No quadrakills. No legend.",
      subtitle: "Someone must finally seize the spotlight at the gala.",
    };
  }
  return {
    headline: `${top.displayName} hovers at the edge of legend.`,
    subtitle: `${top.quadraKills} quadrakills, but the fifth scalp still slips away.`,
  };
}

export function witchingHourBanter(series: HourlySeries[]): Banter {
  // For each player find the hour where winrate collapses (>= 5 games)
  let cinderella: { name: string; hour: number; wr: number } | null = null;
  for (const s of series) {
    for (let h = 0; h < 24; h++) {
      const c = s.hourly[h]!;
      if (c.games < 5) continue;
      const wr = c.wins / c.games;
      if (!cinderella || wr < cinderella.wr) {
        cinderella = { name: s.displayName, hour: h, wr };
      }
    }
  }
  if (!cinderella) return SHRUG;
  const hh = String(cinderella.hour).padStart(2, "0");
  return {
    headline: `${cinderella.name} should not queue at ${hh}:00.`,
    subtitle: `The Cinderella hour — winrate collapses to ${(cinderella.wr * 100).toFixed(0)}%. The carriage is a pumpkin.`,
  };
}

export function objectivesBanter(rows: ObjectiveRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  const dragonSlayer = [...rows].sort((a, b) => b.dragons - a.dragons)[0]!;
  const turretSmasher = [...rows].sort((a, b) => b.turrets - a.turrets)[0]!;
  if (dragonSlayer.dragons === 0 && turretSmasher.turrets === 0) return SHRUG;
  return {
    headline: `${dragonSlayer.displayName} slays dragons (${dragonSlayer.dragons}).`,
    subtitle: `${turretSmasher.displayName} prefers masonry, having toppled ${turretSmasher.turrets} towers. To each their conquest.`,
  };
}

export function crownBanter(entries: CrownEntry[]): Banter {
  if (entries.length === 0) return SHRUG;
  const latest = entries[0]!;
  if (!latest.mvpDisplayName) return SHRUG;
  if (latest.jesterDisplayName && latest.jesterDisplayName !== latest.mvpDisplayName) {
    return {
      headline: `Crown of the Evening: ${latest.mvpDisplayName}.`,
      subtitle: `Wet Blanket of the Evening: ${latest.jesterDisplayName}. The orchestra was unkind.`,
    };
  }
  return {
    headline: `Crown of the Evening: ${latest.mvpDisplayName}.`,
    subtitle: `A solo recital — no rival took the floor.`,
  };
}

export function damageBanter(rows: DamageProfileRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  // Most lopsided physical vs magic split
  let extremist: { row: DamageProfileRow; flavor: "physical" | "magic" | "true"; ratio: number } | null = null;
  for (const r of rows) {
    if (r.total === 0) continue;
    const p = r.physical / r.total;
    const m = r.magic / r.total;
    const t = r.trueDmg / r.total;
    const cand: Array<[number, "physical" | "magic" | "true"]> = [
      [p, "physical"],
      [m, "magic"],
      [t, "true"],
    ];
    cand.sort((a, b) => b[0] - a[0]);
    const [topRatio, topFlavor] = cand[0]!;
    if (!extremist || topRatio > extremist.ratio) {
      extremist = { row: r, flavor: topFlavor, ratio: topRatio };
    }
  }
  if (!extremist) return SHRUG;
  const heaviest = [...rows].sort((a, b) => b.total - a.total)[0]!;
  const flavorWord =
    extremist.flavor === "physical"
      ? "blades and arrows"
      : extremist.flavor === "magic"
        ? "spellbook and sparkles"
        : "raw, unfiltered violence";
  return {
    headline: `${extremist.row.displayName} swears by ${flavorWord}.`,
    subtitle:
      heaviest.puuid === extremist.row.puuid
        ? `${(extremist.ratio * 100).toFixed(0)}% of the damage in one flavour — and the largest stack on the table to boot.`
        : `${(extremist.ratio * 100).toFixed(0)}% of their damage in one flavour. Meanwhile ${heaviest.displayName} has the biggest pile of damage overall.`,
  };
}

export function firstBloodBanter(rows: FirstBloodRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  const bestFB = [...rows].sort((a, b) => b.firstBloodKills - a.firstBloodKills)[0]!;
  const bestFT = [...rows].sort((a, b) => b.firstTowerKills - a.firstTowerKills)[0]!;
  if (bestFB.firstBloodKills === 0 && bestFT.firstTowerKills === 0) {
    return {
      headline: "A quiet opening, every time.",
      subtitle: "No first bloods, no first towers — the pavilion holds its breath.",
    };
  }
  if (bestFB.puuid === bestFT.puuid) {
    return {
      headline: `${bestFB.displayName} eats early — ${bestFB.firstBloodKills} first bloods, ${bestFB.firstTowerKills} first towers.`,
      subtitle: "Sets the tempo, hits the gong, and then the whole pavilion follows.",
    };
  }
  return {
    headline: `${bestFB.displayName} draws first blood ${bestFB.firstBloodKills}× — ${bestFT.displayName} cracks first plate ${bestFT.firstTowerKills}×.`,
    subtitle: "The opener and the architect: two flavours of early-game greed.",
  };
}

export function surrenderBanter(rows: SurrenderRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  // Find the biggest white-flag waver: highest ownTeamFF / games ratio (>= 5 games)
  const flaggers = rows
    .filter((r) => r.games >= 5)
    .map((r) => ({ row: r, ratio: r.games > 0 ? r.ownTeamFF / r.games : 0 }));
  if (flaggers.length === 0) return SHRUG;
  flaggers.sort((a, b) => b.ratio - a.ratio);
  const surrender = flaggers[0]!;
  const stalwarts = rows
    .filter((r) => r.games >= 5)
    .map((r) => ({ row: r, ratio: r.games > 0 ? r.played / r.games : 0 }));
  stalwarts.sort((a, b) => b.ratio - a.ratio);
  const stalwart = stalwarts[0]!;
  if (surrender.row.puuid === stalwart.row.puuid) {
    return {
      headline: `${surrender.row.displayName} keeps a flag handy.`,
      subtitle: `${(surrender.ratio * 100).toFixed(0)}% of their losses are FFs — and yet, ${(stalwart.ratio * 100).toFixed(0)}% of their games run the full nexus marathon.`,
    };
  }
  return {
    headline: `${surrender.row.displayName} waves the white flag fastest.`,
    subtitle: `${(surrender.ratio * 100).toFixed(0)}% of their games end in surrender — meanwhile ${stalwart.row.displayName} grinds it out (${(stalwart.ratio * 100).toFixed(0)}% played to nexus).`,
  };
}

export function durationBanter(rows: DurationRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  // Best short-game closer, best long-game grinder
  let closer: { name: string; wr: number; games: number } | null = null;
  let grinder: { name: string; wr: number; games: number } | null = null;
  for (const r of rows) {
    const s = r.byBucket.short;
    if (s.games >= 5 && (!closer || s.winrate > closer.wr)) {
      closer = { name: r.displayName, wr: s.winrate, games: s.games };
    }
    const l = r.byBucket.long;
    if (l.games >= 5 && (!grinder || l.winrate > grinder.wr)) {
      grinder = { name: r.displayName, wr: l.winrate, games: l.games };
    }
  }
  if (!closer && !grinder) return SHRUG;
  if (closer && grinder && closer.name === grinder.name) {
    return {
      headline: `${closer.name} wins them short and long.`,
      subtitle: `${(closer.wr * 100).toFixed(0)}% in stomps, ${(grinder.wr * 100).toFixed(0)}% in marathons. Pick a fight at any tempo.`,
    };
  }
  if (closer && grinder) {
    return {
      headline: `${closer.name} closes early; ${grinder.name} closes late.`,
      subtitle: `${(closer.wr * 100).toFixed(0)}% in stomps for one, ${(grinder.wr * 100).toFixed(0)}% in marathons for the other.`,
    };
  }
  if (closer) {
    return {
      headline: `${closer.name} loves a fast finish.`,
      subtitle: `${(closer.wr * 100).toFixed(0)}% in sub-25 stomps. The long games are a different theatre.`,
    };
  }
  return {
    headline: `${grinder!.name} survives the marathons.`,
    subtitle: `${(grinder!.wr * 100).toFixed(0)}% in 35+ minute slogs. Patience is a champion.`,
  };
}

export function weekdayBanter(rows: WeekdayRow[]): Banter {
  if (rows.length === 0) return SHRUG;
  let best: { name: string; day: string; wr: number; games: number } | null = null;
  let worst: { name: string; day: string; wr: number; games: number } | null = null;
  for (const r of rows) {
    for (let i = 0; i < 7; i++) {
      const cell = r.byDay[i]!;
      if (cell.games < 5) continue;
      const wr = cell.wins / cell.games;
      const dayLabel = WEEKDAYS[i] ?? "";
      if (!best || wr > best.wr) best = { name: r.displayName, day: dayLabel, wr, games: cell.games };
      if (!worst || wr < worst.wr) worst = { name: r.displayName, day: dayLabel, wr, games: cell.games };
    }
  }
  if (!best || !worst) return SHRUG;
  if (best.name === worst.name) {
    return {
      headline: `${best.name} runs hot on ${best.day}.`,
      subtitle: `${(best.wr * 100).toFixed(0)}% on the best day, ${(worst.wr * 100).toFixed(0)}% on the worst — same player. Pick your day.`,
    };
  }
  return {
    headline: `${best.name} owns ${best.day} (${(best.wr * 100).toFixed(0)}%).`,
    subtitle: `${worst.name} should avoid ${worst.day} — winrate slumps to ${(worst.wr * 100).toFixed(0)}%.`,
  };
}
