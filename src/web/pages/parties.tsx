import type { FC } from "hono/jsx";
import type { PartyRow } from "../../db/queries.js";
import { queueLabel } from "../../lib/queues.js";
import { MatchExpand, MatchRow } from "../components/match-row.js";
import { cn } from "../lib/cn.js";
import { Badge, Empty } from "../components/ui.js";

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const date = sameDay
    ? "today"
    : d.toLocaleDateString("en-CA", { month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

const LANE_ORDER: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  BOTTOM: 3,
  UTILITY: 4,
};

export const PartyCard: FC<{ party: PartyRow }> = ({ party }) => {
  const queue = queueLabel(party.queueId, party.gameMode);
  const solo = party.members.length === 1;
  const soloMember = solo ? party.members[0] : undefined;
  const title = solo
    ? `${soloMember?.displayName ?? soloMember?.gameName ?? "Player"} on ${queue}`
    : `${party.members.length}-stack on ${queue}`;
  const ordered = [...party.members].sort((a, b) => {
    const ao = LANE_ORDER[a.teamPosition ?? ""] ?? 99;
    const bo = LANE_ORDER[b.teamPosition ?? ""] ?? 99;
    return ao - bo;
  });
  return (
    <section
      class={cn(
        "overflow-hidden rounded-2xl border",
        party.win
          ? "bg-gradient-to-br from-success/[0.05] via-card to-card"
          : "bg-gradient-to-br from-destructive/[0.05] via-card to-card",
      )}
    >
      <header class="flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3">
        <div class="flex items-baseline gap-3">
          <h2 class="font-display text-base font-semibold tracking-tight">{title}</h2>
          <p class="text-muted-foreground font-mono text-xs">
            {fmtWhen(party.gameStart)} · {fmtDuration(party.gameDuration)}
          </p>
        </div>
        {party.win ? (
          <Badge variant="success">Victory</Badge>
        ) : (
          <Badge variant="destructive">Defeat</Badge>
        )}
      </header>
      <div class="flex flex-col gap-2 p-3">
        {ordered.map((m) => (
          <MatchRow row={m} embedded showPlayer={!solo} />
        ))}
      </div>
      <MatchExpand matchId={party.matchId} label="Show full match" />
    </section>
  );
};

export const PartiesPage: FC<{ parties: PartyRow[] }> = ({ parties }) => (
  <div class="flex flex-col gap-8">
    <header class="flex flex-col gap-1">
      <h1 class="font-display text-2xl font-semibold tracking-tight">Parties</h1>
      <p class="text-muted-foreground text-sm">
        Matches where two or more tracked friends played on the same team.
      </p>
    </header>
    {parties.length === 0 ? (
      <Empty
        title="No shared matches yet"
        description="Once two tracked players queue together, their match will show up here."
      />
    ) : (
      <div class="flex flex-col gap-8">
        {parties.map((p) => (
          <PartyCard party={p} />
        ))}
      </div>
    )}
  </div>
);
