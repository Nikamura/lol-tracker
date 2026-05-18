import type { FC } from "hono/jsx";
import type {
  AggregateHeatmap,
  Cell,
  HeatmapsData,
  PlayerHeatmap,
} from "../../db/heatmap-queries.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Label,
  Select,
} from "../components/ui.js";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOUR_TICKS = new Set<number>([0, 3, 6, 9, 12, 15, 18, 21]);

const SINCE_OPTIONS: Array<{ value: HeatmapsSince; label: string }> = [
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "all", label: "All time" },
];

const QUEUE_OPTIONS: Array<{ value: HeatmapsQueue; label: string }> = [
  { value: "all", label: "All queues" },
  { value: "soloq", label: "Solo/Duo" },
  { value: "flex", label: "Flex" },
  { value: "ranked", label: "Ranked (Solo+Flex)" },
  { value: "normal", label: "Normals" },
  { value: "aram", label: "ARAM" },
];

export type HeatmapsSince = "7d" | "30d" | "90d" | "all";
export type HeatmapsQueue = "all" | "soloq" | "flex" | "ranked" | "normal" | "aram";

export interface HeatmapsFilters {
  since: HeatmapsSince;
  queue: HeatmapsQueue;
}

export interface HeatmapsProps {
  data: HeatmapsData;
  filters: HeatmapsFilters;
}

/**
 * Map a (winrate, volume) cell to an `hsl(...)` background. Hue is a linear
 * interpolation between red (loss) and green (win) through a neutral middle;
 * alpha scales with how busy the slot is relative to the heatmap-local max.
 */
function cellStyle(cell: Cell, maxGames: number): string {
  const wr = cell.wins / cell.games;
  const hue = Math.round(wr * 120);
  const ratio = maxGames > 0 ? cell.games / maxGames : 0;
  const alpha = 0.15 + 0.85 * ratio;
  return `background-color: hsl(${hue}, 65%, 45% / ${alpha.toFixed(3)})`;
}

function tooltip(dayIdx: number, hour: number, games: number, wins: number): string {
  const day = DAY_LABELS[dayIdx] ?? "?";
  const hh = String(hour).padStart(2, "0");
  const wrPct = Math.round((wins / games) * 100);
  return `${day} ${hh}:00 — ${games} game${games === 1 ? "" : "s"} · ${wrPct}% WR`;
}

interface Summary {
  mostPlayed: Cell | undefined;
  best: Cell | undefined;
  worst: Cell | undefined;
}

function summarize(cells: Cell[]): Summary {
  let mostPlayed: Cell | undefined;
  let best: Cell | undefined;
  let worst: Cell | undefined;
  for (const c of cells) {
    if (!mostPlayed || c.games > mostPlayed.games) mostPlayed = c;
    if (c.games >= 3) {
      const wr = c.wins / c.games;
      if (!best || wr > best.wins / best.games) best = c;
      if (!worst || wr < worst.wins / worst.games) worst = c;
    }
  }
  return { mostPlayed, best, worst };
}

const fmtSlot = (cell: Cell): string =>
  `${DAY_LABELS[cell.dayIdx] ?? "?"} ${String(cell.hour).padStart(2, "0")}:00`;

const SummaryLine: FC<{ cells: Cell[] }> = ({ cells }) => {
  if (cells.length === 0) {
    return (
      <p class="text-muted-foreground text-xs">No games in the selected range.</p>
    );
  }
  const { mostPlayed, best, worst } = summarize(cells);
  const parts: string[] = [];
  if (mostPlayed) {
    parts.push(
      `Most-played ${fmtSlot(mostPlayed)} (${mostPlayed.games} game${mostPlayed.games === 1 ? "" : "s"})`,
    );
  }
  if (best) {
    const wr = Math.round((best.wins / best.games) * 100);
    parts.push(`Best ${fmtSlot(best)} (${wr}% WR, ${best.games}g)`);
  }
  if (worst && (!best || worst !== best)) {
    const wr = Math.round((worst.wins / worst.games) * 100);
    parts.push(`Worst ${fmtSlot(worst)} (${wr}% WR, ${worst.games}g)`);
  }
  return <p class="text-muted-foreground text-xs">{parts.join(" · ")}</p>;
};

const HourTicks: FC = () => (
  <div
    class="grid items-center text-[10px] text-muted-foreground font-mono"
    style="grid-template-columns: auto repeat(24, minmax(0, 1fr))"
  >
    <span />
    {Array.from({ length: 24 }, (_, h) => (
      <span class="text-left">{HOUR_TICKS.has(h) ? h : ""}</span>
    ))}
  </div>
);

const HeatmapGrid: FC<{ cells: Cell[]; maxGames: number }> = ({ cells, maxGames }) => {
  // Index by `${day}|${hour}` so render is O(168) regardless of input size.
  const byKey = new Map<string, Cell>();
  for (const c of cells) byKey.set(`${c.dayIdx}|${c.hour}`, c);

  return (
    <div class="flex flex-col gap-1">
      <HourTicks />
      {DAY_LABELS.map((label, dayIdx) => (
        <div
          class="grid items-center gap-0.5"
          style="grid-template-columns: auto repeat(24, minmax(0, 1fr))"
        >
          <span class="text-muted-foreground pr-2 text-[11px] font-mono w-8">{label}</span>
          {Array.from({ length: 24 }, (_, hour) => {
            const cell = byKey.get(`${dayIdx}|${hour}`);
            if (!cell) {
              return (
                <div
                  class="size-4 rounded-[3px] border border-border/40"
                  title={`${label} ${String(hour).padStart(2, "0")}:00 — 0 games`}
                />
              );
            }
            return (
              <div
                class="size-4 rounded-[3px]"
                style={cellStyle(cell, maxGames)}
                title={tooltip(dayIdx, hour, cell.games, cell.wins)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

const HeatmapBlock: FC<{ title: string; cells: Cell[]; maxGames: number }> = ({
  title,
  cells,
  maxGames,
}) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <SummaryLine cells={cells} />
    </CardHeader>
    <CardContent>
      <HeatmapGrid cells={cells} maxGames={maxGames} />
    </CardContent>
  </Card>
);

export const HeatmapsBody: FC<{ data: HeatmapsData }> = ({ data }) => {
  const { aggregate, perPlayer } = data;
  const empty = aggregate.cells.length === 0 && perPlayer.length === 0;
  if (empty) {
    return (
      <Empty
        title="No matches in range"
        description="Widen the time range, change the queue filter, or run `pnpm dev poll`."
      />
    );
  }
  return (
    <div class="flex flex-col gap-6">
      <AggregateBlock aggregate={aggregate} />
      {perPlayer.map((p) => (
        <HeatmapBlock title={p.displayName} cells={p.cells} maxGames={p.maxGames} />
      ))}
    </div>
  );
};

const AggregateBlock: FC<{ aggregate: AggregateHeatmap }> = ({ aggregate }) => (
  <HeatmapBlock
    title="All friends"
    cells={aggregate.cells}
    maxGames={aggregate.maxGames}
  />
);

export const HeatmapsPage: FC<HeatmapsProps> = ({ data, filters }) => {
  const totalGames = data.aggregate.cells.reduce((sum, c) => sum + c.games, 0);
  const playerCount = data.perPlayer.length;
  return (
    <div class="flex flex-col gap-6 pt-8">
      <header class="flex items-end justify-between gap-4 border-b border-border/40 pb-4">
        <div class="flex flex-col gap-1">
          <span class="scoreboard-eyebrow">FEED · 04 · SCHEDULE</span>
          <h1 class="font-display text-foreground text-4xl leading-none tracking-tight uppercase">
            Heatmaps
          </h1>
          <p class="text-muted-foreground text-sm">
            When each tracked friend plays and how they perform across hour-of-day × day-of-week.
            Buckets use the server's local timezone.
          </p>
        </div>
        <div class="hidden md:flex flex-col items-end gap-1">
          <span class="scoreboard-eyebrow">Players</span>
          <span class="font-mono text-foreground text-2xl leading-none">
            {String(playerCount).padStart(2, "0")}
          </span>
        </div>
      </header>

      <Card>
        <CardContent>
          <form
            class="grid grid-cols-1 gap-4 md:grid-cols-2"
            hx-get="/fragments/heatmaps"
            hx-target="#heatmaps-body"
            hx-trigger="change"
            hx-push-url="true"
            hx-indicator="#heatmaps-spinner"
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

      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span class="font-mono">
          {totalGames} game{totalGames === 1 ? "" : "s"} across {playerCount} player
          {playerCount === 1 ? "" : "s"}
        </span>
        <span id="heatmaps-spinner" class="htmx-indicator">
          Loading…
        </span>
      </div>

      <div id="heatmaps-body">
        <HeatmapsBody data={data} />
      </div>
    </div>
  );
};

// Re-export types so the route layer can build the filter shape without
// reaching into the db module.
export type { Cell, HeatmapsData, PlayerHeatmap };
