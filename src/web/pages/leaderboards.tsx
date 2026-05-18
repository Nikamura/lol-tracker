import type { FC } from "hono/jsx";
import type {
  LeaderboardCategory,
  LeaderboardData,
  LeaderboardRow,
} from "../../db/leaderboard-queries.js";
import { QUEUE_GROUPS } from "../../lib/queues.js";
import { cn } from "../lib/cn.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Label,
  Select,
} from "../components/ui.js";

export interface LeaderboardFilters {
  since: string;
  queue: string;
}

export interface LeaderboardsPageProps {
  data: LeaderboardData;
  filters: LeaderboardFilters;
}

const SINCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "all", label: "All time" },
];

const QUEUE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All queues" },
  ...Object.keys(QUEUE_GROUPS).map((key) => ({ value: key, label: key })),
];

function topValue(category: LeaderboardCategory): number {
  let top = 0;
  for (const r of category.rows) {
    if (r.value !== null && r.value > top) top = r.value;
  }
  return top;
}

function barWidthPct(value: number | null, top: number): number {
  if (value === null || top <= 0) return 0;
  const pct = (value / top) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

const CategoryCard: FC<{ category: LeaderboardCategory }> = ({ category }) => {
  const top = topValue(category);
  const qualifying = category.rows.filter((r) => r.qualifies);
  const ordered = [...qualifying, ...category.rows.filter((r) => !r.qualifies)];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{category.label}</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <Empty title="No data" />
        ) : (
          <ul class="flex flex-col gap-2">
            {ordered.map((row, idx) => (
              <LeaderRow
                row={row}
                rank={row.qualifies ? idx + 1 : null}
                isTop={row.qualifies && idx === 0 && row.value !== null}
                topValue={top}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

const LeaderRow: FC<{
  row: LeaderboardRow;
  rank: number | null;
  isTop: boolean;
  topValue: number;
}> = ({ row, rank, isTop, topValue: top }) => {
  const width = row.qualifies ? barWidthPct(row.value, top) : 0;
  return (
    <li
      class={cn(
        "relative overflow-hidden rounded-md border bg-muted/30 px-3 py-2",
        isTop && "border-amber-400/30",
      )}
    >
      <div
        class={cn(
          "absolute inset-y-0 left-0 bg-muted",
          isTop && "bg-amber-400/15",
        )}
        style={`width: ${width}%`}
        aria-hidden="true"
      />
      <div class="relative flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class={cn(
              "inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1.5 text-xs font-mono",
              isTop
                ? "bg-amber-400/15 text-amber-300"
                : "bg-card text-muted-foreground",
            )}
          >
            {rank ?? "—"}
          </span>
          <span
            class={cn(
              "truncate text-sm font-medium",
              row.qualifies ? "text-foreground" : "text-muted-foreground",
              isTop && "text-amber-300",
            )}
          >
            {row.displayName}
          </span>
        </div>
        <span
          class={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            row.qualifies ? "text-foreground" : "text-muted-foreground",
            isTop && "text-amber-300",
          )}
        >
          {row.display}
        </span>
      </div>
    </li>
  );
};

export const LeaderboardsBody: FC<{ data: LeaderboardData }> = ({ data }) => {
  if (data.categories.every((c) => c.rows.length === 0)) {
    return (
      <Empty
        title="No leaderboards yet"
        description="Add players and let some matches ingest before rankings appear."
      />
    );
  }
  return (
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      {data.categories.map((c) => (
        <CategoryCard category={c} />
      ))}
    </div>
  );
};

export const LeaderboardsPage: FC<LeaderboardsPageProps> = ({ data, filters }) => (
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="font-display text-2xl font-semibold tracking-tight">Leaderboards</h1>
      <p class="text-muted-foreground text-sm">
        Head-to-head rankings across every tracked friend. Per-minute stats exclude Arena
        unless the queue filter is set to arena.
      </p>
    </header>

    <Card>
      <CardContent>
        <form
          class="grid grid-cols-1 gap-4 md:grid-cols-3"
          hx-get="/fragments/leaderboards"
          hx-target="#leaderboards-body"
          hx-trigger="change"
          hx-push-url="true"
          hx-indicator="#leaderboards-spinner"
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
          <div class="flex items-end">
            <span
              id="leaderboards-spinner"
              class="htmx-indicator text-sm text-muted-foreground"
            >
              Loading…
            </span>
          </div>
        </form>
      </CardContent>
    </Card>

    <div id="leaderboards-body">
      <LeaderboardsBody data={data} />
    </div>
  </div>
);
