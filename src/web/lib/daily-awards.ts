import type { DailyPlayerStat } from "../../db/daily-queries.js";
import { ratiosFor } from "../../db/daily-queries.js";

export type AwardKind = "positive" | "negative";

export interface Award {
  id: string;
  kind: AwardKind;
  title: string;
  /** Short emoji/glyph rendered on the card. Plain ASCII so the UI stays clean. */
  glyph: string;
  winnerPuuid: string;
  winnerDisplayName: string;
  /** One-line detail, e.g. "5.2 score · 4 games". */
  detail: string;
  /** Banter line shown under the headline. */
  banter: string;
  /** True if multiple players tied for top score on the underlying stat. */
  shared?: boolean;
}

type Pick<T> = { row: DailyPlayerStat; value: number; extra?: T };

function topBy(
  stats: DailyPlayerStat[],
  value: (s: DailyPlayerStat) => number,
  filter: (s: DailyPlayerStat) => boolean = () => true,
): Pick<undefined> | null {
  const eligible = stats.filter(filter);
  if (eligible.length === 0) return null;
  let best: DailyPlayerStat = eligible[0]!;
  let bestVal = value(best);
  let tied = false;
  for (let i = 1; i < eligible.length; i++) {
    const s = eligible[i]!;
    const v = value(s);
    if (v > bestVal) {
      best = s;
      bestVal = v;
      tied = false;
    } else if (v === bestVal && s.puuid !== best.puuid) {
      tied = true;
    }
  }
  return { row: best, value: bestVal, extra: tied ? undefined : undefined };
}

function bottomBy(
  stats: DailyPlayerStat[],
  value: (s: DailyPlayerStat) => number,
  filter: (s: DailyPlayerStat) => boolean = () => true,
): Pick<undefined> | null {
  return topBy(stats, (s) => -value(s), filter);
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function games(s: DailyPlayerStat): string {
  return `${s.games}g`;
}

/**
 * Compute the awards list for a day. Awards are only emitted when there's a
 * clear winner or non-trivial stat — no "0 first bloods, congrats" trophies.
 */
export function computeAwards(stats: DailyPlayerStat[]): Award[] {
  const out: Award[] = [];
  if (stats.length === 0) return out;
  const multi = stats.length >= 2;

  // --- MVP — highest avg Gatsby score ----------------------------------------
  {
    const pick = topBy(stats, (s) => s.mvpScoreSum / Math.max(1, s.games));
    if (pick) {
      out.push({
        id: "mvp",
        kind: "positive",
        title: "MVP of the Day",
        glyph: "*",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${fmt1(pick.value)} score · ${games(pick.row)}`,
        banter:
          pick.row.games === 1
            ? `One game, but what a game. The pavilion bows.`
            : `Averaged ${fmt1(pick.value)} over ${pick.row.games} games — the orchestra knows its conductor.`,
      });
    }
  }

  // --- Wet Blanket — lowest avg score (only if >1 player) --------------------
  if (multi) {
    const pick = bottomBy(stats, (s) => s.mvpScoreSum / Math.max(1, s.games));
    if (pick && pick.row.puuid !== out[0]?.winnerPuuid) {
      const avg = pick.row.mvpScoreSum / Math.max(1, pick.row.games);
      out.push({
        id: "wet-blanket",
        kind: "negative",
        title: "Wet Blanket",
        glyph: "x",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${fmt1(avg)} score · ${games(pick.row)}`,
        banter:
          pick.row.games === 1
            ? `One game and it soaked the whole gala. Try again.`
            : `${pick.row.games} games of damp confetti — somebody had to be the rain on this parade.`,
      });
    }
  }

  // --- First Blood Brigadier — most first-blood kills ------------------------
  {
    const pick = topBy(stats, (s) => s.firstBloodKills, (s) => s.firstBloodKills > 0);
    if (pick) {
      out.push({
        id: "first-blood",
        kind: "positive",
        title: "First Blood Brigadier",
        glyph: "!",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${pick.value}× first blood${pick.value === 1 ? "" : "s"}`,
        banter: `Drew first blood ${pick.value}× — sets the tempo, every game.`,
      });
    }
  }

  // --- Tower Cracker — most first-tower kills (or fallback most turret kills) -
  {
    const ft = topBy(stats, (s) => s.firstTowerKills, (s) => s.firstTowerKills > 0);
    if (ft) {
      out.push({
        id: "first-tower",
        kind: "positive",
        title: "Tower Cracker",
        glyph: "T",
        winnerPuuid: ft.row.puuid,
        winnerDisplayName: ft.row.displayName,
        detail: `${ft.value}× first tower`,
        banter: `Cracks the first plate ${ft.value}× — the architect of every snowball.`,
      });
    } else {
      const tu = topBy(stats, (s) => s.turretKills, (s) => s.turretKills > 0);
      if (tu) {
        out.push({
          id: "turret-smasher",
          kind: "positive",
          title: "Turret Smasher",
          glyph: "T",
          winnerPuuid: tu.row.puuid,
          winnerDisplayName: tu.row.displayName,
          detail: `${tu.value} turret${tu.value === 1 ? "" : "s"}`,
          banter: `Prefers masonry — ${tu.value} turret${tu.value === 1 ? "" : "s"} toppled.`,
        });
      }
    }
  }

  // --- Pentakill — anyone with one --------------------------------------------
  {
    const pick = topBy(stats, (s) => s.pentaKills, (s) => s.pentaKills > 0);
    if (pick) {
      out.push({
        id: "pentakill",
        kind: "positive",
        title: "Pentakiller",
        glyph: "5",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${pick.value} pentakill${pick.value === 1 ? "" : "s"}`,
        banter: `Five scalps in one rotation. The pavilion plays in your honour.`,
      });
    } else {
      const quad = topBy(stats, (s) => s.quadraKills, (s) => s.quadraKills > 0);
      if (quad) {
        out.push({
          id: "quadrakill",
          kind: "positive",
          title: "On the Edge of Legend",
          glyph: "4",
          winnerPuuid: quad.row.puuid,
          winnerDisplayName: quad.row.displayName,
          detail: `${quad.value} quadrakill${quad.value === 1 ? "" : "s"}`,
          banter: `${quad.value} quadrakill${quad.value === 1 ? "" : "s"} — but the fifth scalp slipped away.`,
        });
      }
    }
  }

  // --- Damage Dealer — highest avg damage per minute -------------------------
  {
    const pick = topBy(
      stats,
      (s) => s.totalDamage / Math.max(1, s.totalDuration / 60),
      (s) => s.games > 0 && s.totalDuration > 0,
    );
    if (pick) {
      out.push({
        id: "damage",
        kind: "positive",
        title: "Damage Dealer",
        glyph: "D",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${Math.round(pick.value)} DPM · ${games(pick.row)}`,
        banter: `Every minute, ${Math.round(pick.value)} damage to champions — a sustained barrage.`,
      });
    }
  }

  // --- Eye of the Pavilion — highest avg vision score per game ---------------
  {
    const pick = topBy(
      stats,
      (s) => s.totalVision / Math.max(1, s.games),
      (s) => s.games > 0 && s.totalVision > 0,
    );
    if (pick) {
      out.push({
        id: "vision",
        kind: "positive",
        title: "Eye of the Pavilion",
        glyph: "o",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${fmt1(pick.value)} vision/game`,
        banter: `Lights the brush. ${fmt1(pick.value)} vision per game — nothing moves unseen.`,
      });
    }
  }

  // --- Objective Slayer — most dragons + barons combined --------------------
  {
    const pick = topBy(
      stats,
      (s) => s.dragonKills + s.baronKills,
      (s) => s.dragonKills + s.baronKills > 0,
    );
    if (pick) {
      const r = pick.row;
      out.push({
        id: "objectives",
        kind: "positive",
        title: "Objective Slayer",
        glyph: "@",
        winnerPuuid: r.puuid,
        winnerDisplayName: r.displayName,
        detail: `${r.dragonKills}D · ${r.baronKills}B`,
        banter: `${r.dragonKills} dragon${r.dragonKills === 1 ? "" : "s"}, ${r.baronKills} baron${r.baronKills === 1 ? "" : "s"} — the neutral camps fear them.`,
      });
    }
  }

  // --- Shotcaller — highest avg kill-participation --------------------------
  {
    const pick = topBy(
      stats,
      (s) => Math.min(1, s.kpSum / Math.max(1, s.games)),
      (s) => s.games > 0,
    );
    if (pick && pick.value >= 0.5) {
      out.push({
        id: "shotcaller",
        kind: "positive",
        title: "Shotcaller",
        glyph: "K",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${fmtPct(pick.value)} KP · ${games(pick.row)}`,
        banter: `${fmtPct(pick.value)} kill participation — every play runs through them.`,
      });
    }
  }

  // --- Streaker — most wins (only if all wins or clear hot hand) ------------
  {
    const pick = topBy(stats, (s) => s.wins, (s) => s.wins >= 2);
    if (pick && pick.row.wins === pick.row.games && pick.row.wins >= 2) {
      out.push({
        id: "streaker",
        kind: "positive",
        title: "Hot Hand",
        glyph: "/",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${pick.row.wins}-0 on the day`,
        banter: `${pick.row.wins} wins, zero losses. Don't change the playlist, don't move the chair.`,
      });
    }
  }

  // --- Workhorse — most games played (only if 3+) ---------------------------
  {
    const pick = topBy(stats, (s) => s.games, (s) => s.games >= 3);
    if (pick) {
      // Only award if they played meaningfully more than the others
      const others = stats.filter((s) => s.puuid !== pick.row.puuid);
      const maxOther = others.reduce((a, s) => Math.max(a, s.games), 0);
      if (pick.row.games >= maxOther + 2 || (others.length === 0 && pick.row.games >= 5)) {
        out.push({
          id: "workhorse",
          kind: "positive",
          title: "Workhorse",
          glyph: "+",
          winnerPuuid: pick.row.puuid,
          winnerDisplayName: pick.row.displayName,
          detail: `${pick.row.games} games`,
          banter: `${pick.row.games} games in a day — when does this person sleep?`,
        });
      }
    }
  }

  // --- Feeder — highest avg deaths (only if >1 player and avg > 5) ----------
  if (multi) {
    const pick = topBy(
      stats,
      (s) => s.totalDeaths / Math.max(1, s.games),
      (s) => s.games > 0,
    );
    if (pick && pick.value > 5) {
      out.push({
        id: "feeder",
        kind: "negative",
        title: "Feeder",
        glyph: "v",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${fmt1(pick.value)} deaths/game`,
        banter:
          pick.row.games === 1
            ? `One game, ${pick.row.totalDeaths} deaths. The enemy team sends thanks.`
            : `${fmt1(pick.value)} deaths per game over ${pick.row.games}. The enemy team sends thanks.`,
      });
    }
  }

  // --- Ghost — lowest avg vision (only if >1 player has any vision) ---------
  if (multi) {
    const eligible = stats.filter((s) => s.games > 0);
    if (eligible.length >= 2) {
      const pick = bottomBy(
        eligible,
        (s) => s.totalVision / Math.max(1, s.games),
      );
      if (pick && pick.row.totalVision / Math.max(1, pick.row.games) < 20) {
        const v = pick.row.totalVision / Math.max(1, pick.row.games);
        out.push({
          id: "ghost",
          kind: "negative",
          title: "Ghost",
          glyph: "-",
          winnerPuuid: pick.row.puuid,
          winnerDisplayName: pick.row.displayName,
          detail: `${fmt1(v)} vision/game`,
          banter: `Prefers the shadows. ${fmt1(v)} vision per game — wards are for other people.`,
        });
      }
    }
  }

  // --- Coal Burner — lowest avg KDA (only if >1 player and KDA < 1.5) -------
  if (multi) {
    const pick = bottomBy(
      stats,
      (s) => (s.totalKills + s.totalAssists) / Math.max(1, s.totalDeaths),
      (s) => s.games > 0,
    );
    if (pick && pick.value > 0) {
      const kda = (pick.row.totalKills + pick.row.totalAssists) / Math.max(1, pick.row.totalDeaths);
      if (kda < 1.5 && pick.row.puuid !== out[0]?.winnerPuuid) {
        out.push({
          id: "coal-burner",
          kind: "negative",
          title: "Coal Burner",
          glyph: ".",
          winnerPuuid: pick.row.puuid,
          winnerDisplayName: pick.row.displayName,
          detail: `${fmt1(kda)} KDA · ${games(pick.row)}`,
          banter: `KDA ${fmt1(kda)}. The shovel keeps moving, the fire stays out.`,
        });
      }
    }
  }

  // --- Surrender Monkey — most own-team FF losses ---------------------------
  {
    const pick = topBy(stats, (s) => s.ownTeamFF, (s) => s.ownTeamFF >= 2);
    if (pick) {
      out.push({
        id: "ff",
        kind: "negative",
        title: "Surrender Monkey",
        glyph: "F",
        winnerPuuid: pick.row.puuid,
        winnerDisplayName: pick.row.displayName,
        detail: `${pick.value} FF loss${pick.value === 1 ? "" : "es"}`,
        banter: `Keeps a white flag handy — ${pick.value} games waved off.`,
      });
    }
  }

  // --- Tilt Champion — worst winrate (only if >1 player with 2+ games) ------
  if (multi) {
    const eligible = stats.filter((s) => s.games >= 2);
    if (eligible.length >= 2) {
      const pick = bottomBy(eligible, (s) => s.wins / Math.max(1, s.games));
      if (pick) {
        const wr = pick.row.wins / Math.max(1, pick.row.games);
        if (wr <= 0.3 && pick.row.puuid !== out.find((a) => a.id === "wet-blanket")?.winnerPuuid) {
          out.push({
            id: "tilted",
            kind: "negative",
            title: "Tilted",
            glyph: "~",
            winnerPuuid: pick.row.puuid,
            winnerDisplayName: pick.row.displayName,
            detail: `${pick.row.wins}-${pick.row.losses} · ${fmtPct(wr)}`,
            banter: `${pick.row.wins}W ${pick.row.losses}L. Time for a tea break and a fresh queue.`,
          });
        }
      }
    }
  }

  // Order: positives first, then negatives. MVP at the very top, Wet Blanket
  // first among negatives.
  const order = (a: Award) => {
    if (a.id === "mvp") return 0;
    if (a.kind === "positive") return 1;
    if (a.id === "wet-blanket") return 2;
    return 3;
  };
  out.sort((a, b) => order(a) - order(b));
  return out;
}

/** Convenience: re-export so the page can shape stats for tables. */
export { ratiosFor };
