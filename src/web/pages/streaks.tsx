import type { FC } from "hono/jsx";
import type { Last10Game, PlayerStreaks, StreaksData } from "../../db/streak-queries.js";
import { QUEUE_GROUPS } from "../../lib/queues.js";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Label,
  Select,
} from "../components/ui.js";
import { cn } from "../lib/cn.js";

const SINCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "", label: "All time" },
];

const QUEUE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All queues" },
  ...Object.keys(QUEUE_GROUPS).map((key) => ({ value: key, label: key })),
];

export interface StreaksFilters {
  since: string;
  queue: string;
}

export interface StreaksProps {
  data: StreaksData;
  filters: StreaksFilters;
}

function currentChipClass(sign: "W" | "L" | "-"): string {
  if (sign === "W") return "bg-success/15 text-success";
  if (sign === "L") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}

function currentLabel(sign: "W" | "L" | "-", length: number): string {
  if (sign === "-" || length === 0) return "—";
  return `${sign}${length}`;
}

function kdaFmt(n: number): string {
  return n.toFixed(1);
}

function squareTitle(g: Last10Game): string {
  const verb = g.win ? "W" : "L";
  if (g.opponentChampion) return `${verb} vs ${g.opponentChampion}`;
  return g.win ? "Win" : "Loss";
}

const Last10Strip: FC<{ games: Last10Game[] }> = ({ games }) => {
  const pad = Math.max(0, 10 - games.length);
  return (
    <div class="flex items-center gap-1">
      {Array.from({ length: pad }).map(() => (
        <span
          class="size-3 rounded border border-dashed border-border/60"
          title="No game"
        />
      ))}
      {games.map((g) => (
        <span
          class={cn(
            "size-3 rounded",
            g.win ? "bg-success/70" : "bg-destructive/70",
          )}
          title={squareTitle(g)}
        />
      ))}
    </div>
  );
};

const NumericPanel: FC<{ player: PlayerStreaks }> = ({ player }) => (
  <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
    <Stat label="Longest W" value={player.longestW.toString()} />
    <Stat label="Longest L" value={player.longestL.toString()} />
    <Stat
      label="Last-10"
      value={`${player.last10Wins}-${player.last10Losses}`}
    />
    <Stat label="Last-10 KDA" value={kdaFmt(player.last10AvgKda)} />
    <Stat
      label="Late-night"
      value={player.lateNightCount.toString()}
      tooltip="Matches starting 22:00–05:00 — uses server local time"
    />
  </dl>
);

const Stat: FC<{ label: string; value: string; tooltip?: string }> = ({
  label,
  value,
  tooltip,
}) => (
  <div class="flex flex-col gap-0.5" title={tooltip}>
    <dt
      class={cn(
        "text-muted-foreground/70 text-[10px] uppercase tracking-wide",
        tooltip && "decoration-dotted underline underline-offset-2",
      )}
    >
      {label}
    </dt>
    <dd class="font-mono text-foreground text-sm">{value}</dd>
  </div>
);

const StatusBadge: FC<{ player: PlayerStreaks }> = ({ player }) => {
  if (player.tilt) return <Badge variant="destructive">TILT</Badge>;
  if (player.hot) return <Badge variant="success">HOT</Badge>;
  return null;
};

const PlayerCard: FC<{ player: PlayerStreaks }> = ({ player }) => {
  const chipClass = currentChipClass(player.current.sign);
  const chipLabel = currentLabel(player.current.sign, player.current.length);
  return (
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <CardTitle>{player.displayName}</CardTitle>
            <StatusBadge player={player} />
          </div>
          <span
            class={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold",
              chipClass,
            )}
            title={
              player.current.length > 0
                ? `Current streak: ${player.current.length} ${player.current.sign === "W" ? "win(s)" : "loss(es)"} in a row`
                : "No current streak"
            }
          >
            {chipLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex flex-col gap-1">
              <span class="text-muted-foreground/70 text-[10px] uppercase tracking-wide">
                Last 10
              </span>
              <Last10Strip games={player.last10} />
            </div>
            {player.totalGames === 0 ? (
              <span class="text-muted-foreground text-xs">
                No matches in window
              </span>
            ) : null}
          </div>
          <NumericPanel player={player} />
        </div>
      </CardContent>
    </Card>
  );
};

export const StreaksBody: FC<{ data: StreaksData }> = ({ data }) => {
  if (data.players.length === 0) {
    return (
      <Empty
        title="No tracked players"
        description="Run `pnpm dev add <gameName#tagLine> --platform <p>` to start tracking."
      />
    );
  }
  const anyGames = data.players.some((p) => p.totalGames > 0);
  if (!anyGames) {
    return (
      <Empty
        title="No matches in window"
        description="Widen 'since' or run `pnpm dev poll`."
      />
    );
  }
  return (
    <div class="flex flex-col gap-4">
      {data.players.map((p) => (
        <PlayerCard player={p} />
      ))}
    </div>
  );
};

export const StreaksPage: FC<StreaksProps> = ({ data, filters }) => (
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="font-display text-2xl font-semibold tracking-tight">
        Streaks & tilt
      </h1>
      <p class="text-muted-foreground text-sm">
        Winning/losing streaks, last-10 form, and late-night sessions per tracked
        player.
      </p>
    </header>

    <Card>
      <CardContent>
        <form
          class="grid grid-cols-1 gap-4 md:grid-cols-2"
          hx-get="/fragments/streaks"
          hx-target="#streaks-body"
          hx-trigger="change"
          hx-push-url="true"
          hx-indicator="#streaks-spinner"
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
        </form>
      </CardContent>
    </Card>

    <div class="flex items-center justify-end text-sm">
      <span id="streaks-spinner" class="htmx-indicator text-muted-foreground">
        Loading…
      </span>
    </div>

    <div id="streaks-body">
      <StreaksBody data={data} />
    </div>
  </div>
);
