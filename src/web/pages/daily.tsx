import type { FC } from "hono/jsx";
import type {
  DailyComparison,
  DailyPlayerStat,
  DayOption,
} from "../../db/daily-queries.js";
import { ratiosFor } from "../../db/daily-queries.js";
import { computeAwards, type Award } from "../lib/daily-awards.js";
import { PartyCard } from "./parties.js";
import { Card, CardContent, Empty, Label, Select } from "../components/ui.js";
import { cn } from "../lib/cn.js";

export interface DailyFilters {
  date: string; // YYYY-MM-DD
}

function fmtDayHeading(dayMs: number): string {
  const d = new Date(dayMs);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDayShort(dayMs: number): string {
  const d = new Date(dayMs);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const AwardCard: FC<{ award: Award }> = ({ award }) => (
  <article
    class={cn(
      "relative flex flex-col gap-2 overflow-hidden rounded-sm border bg-card p-4",
      award.kind === "positive"
        ? "border-success/30"
        : "border-destructive/30",
    )}
  >
    <span
      class={cn(
        "absolute inset-x-0 top-0 h-[2px]",
        award.kind === "positive" ? "bg-success/70" : "bg-destructive/70",
      )}
      aria-hidden="true"
    />
    <div class="flex items-baseline justify-between gap-3">
      <span class="scoreboard-eyebrow">
        <span
          class={cn(
            "mr-1 inline-block w-4 text-center font-mono font-bold",
            award.kind === "positive" ? "text-success" : "text-destructive",
          )}
          aria-hidden="true"
        >
          {award.glyph}
        </span>
        {award.title}
      </span>
      <span class="font-mono text-xs text-muted-foreground">{award.detail}</span>
    </div>
    <p class="font-display text-foreground text-xl leading-tight tracking-wide uppercase">
      {award.winnerDisplayName}
    </p>
    <p class="text-sm italic text-muted-foreground">{award.banter}</p>
  </article>
);

const StatsTable: FC<{ stats: DailyPlayerStat[] }> = ({ stats }) => {
  if (stats.length === 0) return null;
  return (
    <div class="overflow-x-auto rounded-sm border border-border/70 bg-card">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
            <th class="px-3 py-2 text-left font-medium">Player</th>
            <th class="px-3 py-2 text-right font-medium">Games</th>
            <th class="px-3 py-2 text-right font-medium">W/L</th>
            <th class="px-3 py-2 text-right font-medium">Avg KDA</th>
            <th class="px-3 py-2 text-right font-medium">Avg K/D/A</th>
            <th class="px-3 py-2 text-right font-medium">KP</th>
            <th class="px-3 py-2 text-right font-medium">DPM</th>
            <th class="px-3 py-2 text-right font-medium">Vis/g</th>
            <th class="px-3 py-2 text-right font-medium">CS/m</th>
            <th class="px-3 py-2 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => {
            const r = ratiosFor(s);
            return (
              <tr class="border-b border-border/30 last:border-b-0 hover:bg-muted/30">
                <td class="px-3 py-2">
                  <a
                    href={`/players/${s.puuid}`}
                    class="font-medium text-foreground hover:underline"
                  >
                    {i === 0 ? (
                      <span class="mr-1 text-success" aria-hidden="true">★</span>
                    ) : null}
                    {s.displayName}
                  </a>
                </td>
                <td class="px-3 py-2 text-right font-mono text-xs">{s.games}</td>
                <td class="px-3 py-2 text-right font-mono text-xs">
                  <span class="text-success">{s.wins}</span>
                  <span class="text-muted-foreground">–</span>
                  <span class="text-destructive">{s.losses}</span>
                </td>
                <td class="px-3 py-2 text-right font-mono">{r.avgKda.toFixed(2)}</td>
                <td class="px-3 py-2 text-right font-mono text-xs">
                  {r.avgKills.toFixed(1)}/{r.avgDeaths.toFixed(1)}/{r.avgAssists.toFixed(1)}
                </td>
                <td class="px-3 py-2 text-right font-mono">{Math.round(Math.min(1, r.avgKP) * 100)}%</td>
                <td class="px-3 py-2 text-right font-mono">{Math.round(r.avgDpm)}</td>
                <td class="px-3 py-2 text-right font-mono">{r.avgVision.toFixed(1)}</td>
                <td class="px-3 py-2 text-right font-mono">{r.avgCsPerMin.toFixed(1)}</td>
                <td class="px-3 py-2 text-right font-mono">
                  {r.avgMvpScore.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export interface DailyBodyProps {
  data: DailyComparison;
}

export const DailyBody: FC<DailyBodyProps> = ({ data }) => {
  const awards = computeAwards(data.stats);
  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <h2 class="font-display text-foreground text-2xl leading-none tracking-tight uppercase">
          {fmtDayHeading(data.dayMs)}
        </h2>
        <div class="flex items-center gap-3 text-sm">
          <span class="font-mono text-muted-foreground">{data.dayKey}</span>
          <span class="scoreboard-eyebrow text-muted-foreground">
            {data.stats.length} player{data.stats.length === 1 ? "" : "s"} · {data.totalMatches} match{data.totalMatches === 1 ? "" : "es"}
          </span>
        </div>
      </div>

      {awards.length === 0 ? (
        <Empty title="No awards yet" description="Awards appear when the day has enough action to compare." />
      ) : (
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {awards.map((a) => (
            <AwardCard award={a} />
          ))}
        </div>
      )}

      <div class="flex flex-col gap-2">
        <h3 class="scoreboard-eyebrow text-muted-foreground">Per-player scoreboard</h3>
        <StatsTable stats={data.stats} />
      </div>

      <div class="flex flex-col gap-3">
        <h3 class="scoreboard-eyebrow text-muted-foreground">Matches</h3>
        {data.parties.length === 0 ? (
          <Empty title="No matches" />
        ) : (
          <div class="flex flex-col gap-4">
            {data.parties.map((p) => (
              <PartyCard party={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export interface DailyPageProps {
  data: DailyComparison | null;
  filters: DailyFilters;
  days: DayOption[];
  /** True when the requested date had no multi-friend activity. */
  fallback: boolean;
}

const DayPicker: FC<{ days: DayOption[]; selected: string }> = ({ days, selected }) => (
  <Select id="date" name="date">
    {days.length === 0 ? (
      <option value="">No multi-friend days yet</option>
    ) : (
      days.map((d) => (
        <option value={d.dayKey} selected={d.dayKey === selected}>
          {fmtDayShort(d.dayMs)} · {d.dayKey} · {d.friendCount} friends, {d.matchCount} matches
        </option>
      ))
    )}
  </Select>
);

export const DailyPage: FC<DailyPageProps> = ({ data, filters, days, fallback }) => {
  const prev = data?.prevDayMs ?? null;
  const next = data?.nextDayMs ?? null;
  const prevKey = prev !== null ? days.find((d) => d.dayMs === prev)?.dayKey : null;
  const nextKey = next !== null ? days.find((d) => d.dayMs === next)?.dayKey : null;
  return (
    <div class="flex flex-col gap-6 pt-8">
      <header class="flex items-end justify-between gap-4 border-b border-border/40 pb-4">
        <div class="flex flex-col gap-1">
          <span class="scoreboard-eyebrow">FEED · 07 · DAILY DIGEST</span>
          <h1 class="font-display text-foreground text-4xl leading-none tracking-tight uppercase">
            Daily Comparison
          </h1>
          <p class="text-muted-foreground text-sm">
            End-of-day awards from the friend group. Ranked solo/flex only — Arena, ARAM
            and other queues are excluded so the comparison stays apples-to-apples. Stats
            average across the day so one bad game doesn't crown a Wet Blanket. Only days
            where two or more friends played ranked are shown — pick a day, settle the banter.
          </p>
        </div>
      </header>

      <Card>
        <CardContent>
          <form
            class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
            hx-get="/fragments/daily"
            hx-target="#daily-body"
            hx-trigger="change"
            hx-push-url="true"
            hx-indicator="#daily-spinner"
          >
            <div class="flex flex-1 flex-col gap-1.5 md:max-w-md">
              <Label for="date">Day</Label>
              <DayPicker days={days} selected={filters.date} />
            </div>
            <div class="flex items-center gap-2">
              {prevKey ? (
                <a
                  href={`/daily?date=${prevKey}`}
                  class="rounded-sm border border-border/70 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  ← {prevKey}
                </a>
              ) : null}
              {nextKey ? (
                <a
                  href={`/daily?date=${nextKey}`}
                  class="rounded-sm border border-border/70 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {nextKey} →
                </a>
              ) : null}
              <span
                id="daily-spinner"
                class="htmx-indicator text-sm text-muted-foreground"
              >
                Loading…
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      <div id="daily-body">
        {fallback && data ? (
          <p class="text-sm italic text-muted-foreground">
            {filters.date
              ? `No multi-friend activity on ${filters.date}. Showing the most recent qualifying day.`
              : `Today is quiet so far — showing the most recent day with multi-friend activity.`}
          </p>
        ) : null}
        {data ? (
          <DailyBody data={data} />
        ) : (
          <Empty
            title="No multi-friend days yet"
            description="A day qualifies once two or more tracked friends have each played a ranked solo/flex match. Keep queuing."
          />
        )}
      </div>
    </div>
  );
};
