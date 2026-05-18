import type { FC } from "hono/jsx";
import type { PartyRow, Player } from "../../db/queries.js";
import { QUEUE_GROUPS } from "../../lib/queues.js";
import { PartyCard } from "./parties.js";
import {
  Card,
  CardContent,
  Empty,
  Input,
  Label,
  Select,
} from "../components/ui.js";

export interface TimelineProps {
  parties: PartyRow[];
  players: Player[];
  filters: {
    since: string;
    queue: string;
    player: string;
    limit: string;
  };
}

export const TimelineRows: FC<{ parties: PartyRow[] }> = ({ parties }) => {
  if (parties.length === 0) {
    return (
      <Empty
        title="No matches found"
        description="Try widening the time range or running `pnpm dev poll`."
      />
    );
  }
  return (
    <div class="flex flex-col gap-6">
      {parties.map((p) => (
        <PartyCard party={p} />
      ))}
    </div>
  );
};

const QUEUE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All queues" },
  ...Object.keys(QUEUE_GROUPS).map((key) => ({ value: key, label: key })),
];

const SINCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "", label: "All time" },
];

export const TimelinePage: FC<TimelineProps> = ({ parties, players, filters }) => {
  const matchCount = parties.length;
  const stackCount = parties.filter((p) => p.members.length >= 2).length;
  return (
    <div class="flex flex-col gap-6 pt-8">
      <header class="flex items-end justify-between gap-4 border-b border-border/40 pb-4">
        <div class="flex flex-col gap-1">
          <span class="scoreboard-eyebrow">FEED · 01</span>
          <h1 class="font-display text-foreground text-4xl leading-none tracking-tight">
            TIMELINE
          </h1>
          <p class="text-muted-foreground text-sm">
            Every match across the friend group, grouped by team. Newest first.
          </p>
        </div>
        <div class="hidden md:flex flex-col items-end gap-1">
          <span class="scoreboard-eyebrow">Index</span>
          <span class="font-mono text-foreground text-2xl leading-none">
            {String(matchCount).padStart(3, "0")}
          </span>
        </div>
      </header>

      <Card>
        <CardContent>
          <form
            class="grid grid-cols-1 gap-4 md:grid-cols-4"
            hx-get="/fragments/timeline"
            hx-target="#timeline-rows"
            hx-trigger="change, keyup delay:300ms from:input[name='limit']"
            hx-push-url="true"
            hx-indicator="#timeline-spinner"
          >
            <div class="flex flex-col gap-1.5">
              <Label for="since">Since</Label>
              <Select id="since" name="since">
                {SINCE_OPTIONS.map((opt) => (
                  <option value={opt.value} selected={opt.value === filters.since}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="queue">Queue</Label>
              <Select id="queue" name="queue">
                {QUEUE_OPTIONS.map((opt) => (
                  <option value={opt.value} selected={opt.value === filters.queue}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="player">Player</Label>
              <Select id="player" name="player">
                <option value="" selected={filters.player === ""}>
                  All players
                </option>
                {players.map((p) => (
                  <option value={p.puuid} selected={p.puuid === filters.player}>
                    {p.displayName ?? p.gameName}
                  </option>
                ))}
              </Select>
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="limit">Limit</Label>
              <Input id="limit" name="limit" type="number" min="1" max="500" value={filters.limit} />
            </div>
          </form>
        </CardContent>
      </Card>

      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span class="font-mono">
          {matchCount} {matchCount === 1 ? "match" : "matches"} · {stackCount} with a stack
        </span>
        <span id="timeline-spinner" class="htmx-indicator">
          Loading…
        </span>
      </div>

      <div id="timeline-rows">
        <TimelineRows parties={parties} />
      </div>
    </div>
  );
};
