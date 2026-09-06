import type { FC } from "hono/jsx";

export type MatchIconName = "damage" | "shield" | "gold" | "cs" | "level" | "xp" | "clock" | "vision" | "heal" | "tower" | "monster" | "chart" | "overview" | "champions" | "compare" | "play" | "pause" | "shop" | "undo" | "sell" | "magic" | "filter";
export const MatchIcon: FC<{ name: MatchIconName }> = ({ name }) => (
  <svg class="match-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href={`/static/match-icons.svg#${name}`} /></svg>
);

/** Shared visual vocabulary for the existing statistic labels. */
export function statIcon(label: string): MatchIconName {
  if (/vision|ward/i.test(label)) return "vision";
  if (/heal/i.test(label)) return "heal";
  if (/taken|tank|shield|mitigat|crowd control/i.test(label)) return "shield";
  if (/tower|turret|inhib|building|plate/i.test(label)) return "tower";
  if (/drake|dragon|baron|monster|objective|soul/i.test(label)) return "monster";
  if (/gold|income/i.test(label)) return "gold";
  if (/^cs|minion/i.test(label)) return "cs";
  if (/level/i.test(label)) return "level";
  if (/magic/i.test(label)) return "magic";
  if (/true|xp|victory|score|total$/i.test(label)) return "xp";
  if (/time|duration/i.test(label)) return "clock";
  if (/participation|team/i.test(label)) return "champions";
  return "damage";
}
export function eventIcon(kind: string): MatchIconName {
  return kind === "kill" ? "damage" : kind === "ward" ? "vision" : kind === "building" || kind === "plate" ? "tower" : "monster";
}
