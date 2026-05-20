/**
 * Gatsby Score — the composite per-game rating that drives MVP/Wet Blanket
 * awards (daily-queries.ts) and Crown of the Evening (comparison-queries.ts).
 *
 * Role-aware: the raw stat weights reward KP, vision, drake/baron, and champ
 * damage, all of which top lane structurally trails. Without compensation the
 * Top player essentially can't win MVP. We rebalance for TOP only — other
 * roles keep the original weights so existing scores don't drift.
 *
 * Top-lane adjustments:
 *   - KP target scaled to 60% (an island-lane KP of 0.6 now earns the full
 *     4 points instead of 2.4).
 *   - Turrets weighted 0.7 (split-push / side-lane plates).
 *   - Damage-taken credit (tank/bruiser soak).
 *   - Damage-to-buildings credit (siege contribution).
 */
export interface GatsbyScoreArgs {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  damageTaken: number;
  damageToBuildings: number;
  vision: number;
  dragons: number;
  barons: number;
  turrets: number;
  win: boolean;
  kp: number;
  teamPosition: string | null | undefined;
}

export function gatsbyScore(a: GatsbyScoreArgs): number {
  const kda = (a.kills + a.assists) / Math.max(1, a.deaths);
  const isTop = (a.teamPosition ?? "").toUpperCase() === "TOP";

  const kpScore = isTop ? Math.min(1, a.kp / 0.6) : Math.min(1, a.kp);
  const turretWeight = isTop ? 0.7 : 0.4;
  const tankCredit = isTop ? 0.00006 * a.damageTaken : 0;
  const siegeCredit = isTop ? 0.0002 * a.damageToBuildings : 0;

  return (
    2.0 * Math.min(8, kda) +
    4.0 * kpScore +
    0.0006 * a.damage +
    tankCredit +
    siegeCredit +
    0.04 * a.vision +
    1.5 * (a.dragons + a.barons) +
    turretWeight * a.turrets +
    (a.win ? 2.0 : -1.0) -
    0.4 * Math.max(0, a.deaths - 6)
  );
}
