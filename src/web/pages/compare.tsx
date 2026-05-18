import type { FC } from "hono/jsx";
import type {
  ChampionAffairData,
  CrownEntry,
  HourlySeries,
  LaneRow,
  MultiKillRow,
  ObjectiveRow,
  PavilionData,
  RadarData,
  RankRaceData,
  ScatterSeries,
  VisionRow,
} from "../../db/comparison-queries.js";
import { LANES } from "../../db/comparison-queries.js";
import { QUEUE_GROUPS } from "../../lib/queues.js";
import {
  championAffairBanter,
  crownBanter,
  goldCurveBanter,
  laneBanter,
  objectivesBanter,
  pentakillBanter,
  radarBanter,
  rankRaceBanter,
  visionBanter,
  witchingHourBanter,
} from "../lib/banter.js";
import { Chart, ChartBoot } from "../components/chart.js";
import { DecoCaption, DecoFrame } from "../components/deco.js";
import { Card, CardContent, Empty, Label, Select } from "../components/ui.js";

export interface CompareFilters {
  since: string;
  queue: string;
}

const SINCE_OPTIONS = [
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "90d", label: "Last 90d" },
  { value: "all", label: "All time" },
];

const QUEUE_OPTIONS = [
  { value: "all", label: "All queues" },
  ...Object.keys(QUEUE_GROUPS).map((key) => ({ value: key, label: key })),
];

// A palette for series — gold/cream/rose/jade/lavender. Cycles across players.
const PALETTE = [
  "#d4af37", // gold
  "#c9a36b", // brass
  "#9bc4a1", // jade
  "#e29ea4", // rose
  "#a8b8e0", // lavender
  "#e6c87a", // champagne
  "#88b4c8", // sapphire mist
  "#d59a6b", // copper
];

function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const RankRacePanel: FC<{ data: RankRaceData }> = ({ data }) => {
  if (data.series.length === 0 || !data.domain) {
    return <Empty title="No rank snapshots yet" description="Snapshots accumulate as the poller runs." />;
  }
  const datasets = data.series.map((s, i) => ({
    label: s.displayName,
    data: s.points.map((p) => ({ x: p.t, y: p.lp })),
    borderColor: colorFor(i),
    backgroundColor: withAlpha(colorFor(i), 0.15),
    tension: 0.25,
    pointRadius: 2,
    borderWidth: 2,
  }));
  const config = {
    type: "line",
    data: { datasets },
    options: {
      parsing: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "day" },
          min: data.domain[0],
          max: data.domain[1],
        },
        y: { title: { display: true, text: "Rank scalar (LP)" } },
      },
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={320} />
      <DecoCaption banter={rankRaceBanter(data)} />
    </>
  );
};

const RadarPanel: FC<{ data: RadarData }> = ({ data }) => {
  if (data.players.length === 0) return <Empty title="No matches yet" />;
  const datasets = data.players.map((p, i) => ({
    label: p.displayName,
    data: p.norm.map((v) => Math.round(v * 100)),
    borderColor: colorFor(i),
    backgroundColor: withAlpha(colorFor(i), 0.18),
    borderWidth: 2,
    pointRadius: 3,
  }));
  const config = {
    type: "radar",
    data: { labels: [...data.axes], datasets },
    options: {
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25, showLabelBackdrop: false },
        },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={380} />
      <DecoCaption banter={radarBanter(data)} />
    </>
  );
};

const ChampionAffairPanel: FC<{ data: ChampionAffairData }> = ({ data }) => {
  if (data.champions.length === 0 || data.players.length === 0) {
    return <Empty title="No champion data" />;
  }
  const byPair = new Map(data.cells.map((c) => [`${c.puuid}|${c.championName}`, c]));
  return (
    <>
      <div class="gatsby-heatmap-scroll">
        <table class="gatsby-heatmap">
          <thead>
            <tr>
              <th class="gatsby-heatmap__corner"></th>
              {data.champions.map((c) => (
                <th class="gatsby-heatmap__champ">
                  <span>{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.players.map((p) => (
              <tr>
                <th scope="row" class="gatsby-heatmap__row-label">{p.displayName}</th>
                {data.champions.map((c) => {
                  const cell = byPair.get(`${p.puuid}|${c}`);
                  if (!cell || cell.games === 0) {
                    return <td class="gatsby-heatmap__cell gatsby-heatmap__cell--empty">·</td>;
                  }
                  // Color by winrate: red→amber→gold→jade
                  const wr = cell.winrate;
                  const size = Math.min(1, cell.games / 10);
                  const bg = winrateColor(wr, 0.15 + size * 0.65);
                  return (
                    <td
                      class="gatsby-heatmap__cell"
                      style={`background:${bg}`}
                      title={`${p.displayName} · ${c}: ${cell.wins}/${cell.games} (${Math.round(wr * 100)}%)`}
                    >
                      {cell.games}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DecoCaption banter={championAffairBanter(data)} />
    </>
  );
};

function winrateColor(wr: number, alpha: number): string {
  if (wr >= 0.55) return `rgba(155,196,161,${alpha})`; // jade
  if (wr >= 0.50) return `rgba(212,175,55,${alpha})`; // gold
  if (wr >= 0.40) return `rgba(226,158,107,${alpha})`; // copper
  return `rgba(226,118,124,${alpha})`; // rose-red
}

const LanePanel: FC<{ rows: LaneRow[] }> = ({ rows }) => {
  if (rows.length === 0) return <Empty title="No lane data" />;
  const datasets = LANES.map((lane, idx) => ({
    label: lane,
    backgroundColor: colorFor(idx),
    data: rows.map((r) => {
      const cell = r.byLane[lane];
      return cell.games >= 3 ? Math.round(cell.winrate * 100) : null;
    }),
  }));
  const config = {
    type: "bar",
    data: { labels: rows.map((r) => r.displayName), datasets },
    options: {
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: "Winrate %" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={320} />
      <DecoCaption banter={laneBanter(rows)} />
    </>
  );
};

const GoldCurvePanel: FC<{ series: ScatterSeries[] }> = ({ series }) => {
  if (series.length === 0) return <Empty title="No match data" />;
  const datasets = series.map((s, i) => ({
    label: s.displayName,
    data: s.points.map((p) => ({ x: p.gpm, y: p.dpm })),
    backgroundColor: withAlpha(colorFor(i), 0.55),
    borderColor: colorFor(i),
    pointRadius: 3,
  }));
  const config = {
    type: "scatter",
    data: { datasets },
    options: {
      scales: {
        x: { title: { display: true, text: "Gold / min" } },
        y: { title: { display: true, text: "Damage / min" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={340} />
      <DecoCaption banter={goldCurveBanter(series)} />
    </>
  );
};

const VisionPanel: FC<{ rows: VisionRow[] }> = ({ rows }) => {
  if (rows.length === 0) return <Empty title="No vision data" />;
  const labels = rows.map((r) => r.displayName);
  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Wards placed", backgroundColor: colorFor(0), data: rows.map((r) => round1(r.wardsPlaced)) },
        { label: "Wards killed", backgroundColor: colorFor(1), data: rows.map((r) => round1(r.wardsKilled)) },
        { label: "Control wards", backgroundColor: colorFor(2), data: rows.map((r) => round1(r.controlWards)) },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, title: { display: true, text: "Per game" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={320} />
      <DecoCaption banter={visionBanter(rows)} />
    </>
  );
};

const PentakillPanel: FC<{ rows: MultiKillRow[] }> = ({ rows }) => {
  if (rows.length === 0) return <Empty title="No multikill data" />;
  const totalPentas = rows.reduce((a, r) => a + r.pentaKills, 0);
  const doughnut = totalPentas > 0
    ? {
        type: "doughnut",
        data: {
          labels: rows.filter((r) => r.pentaKills > 0).map((r) => r.displayName),
          datasets: [
            {
              data: rows.filter((r) => r.pentaKills > 0).map((r) => r.pentaKills),
              backgroundColor: rows.filter((r) => r.pentaKills > 0).map((_, i) => colorFor(i)),
              borderColor: "rgba(11,11,13,0.9)",
              borderWidth: 2,
            },
          ],
        },
        options: { plugins: { legend: { position: "bottom" } } },
      }
    : null;
  return (
    <>
      <div class="gatsby-pentakill-grid">
        <div>
          {doughnut ? (
            <Chart config={doughnut} height={260} />
          ) : (
            <div class="gatsby-empty-doughnut">
              <p>No pentakills</p>
              <p class="muted">yet.</p>
            </div>
          )}
        </div>
        <table class="gatsby-multikill-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>2×</th>
              <th>3×</th>
              <th>4×</th>
              <th>5×</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => b.pentaKills - a.pentaKills || b.quadraKills - a.quadraKills)
              .map((r) => (
                <tr>
                  <td>{r.displayName}</td>
                  <td>{r.doubleKills}</td>
                  <td>{r.tripleKills}</td>
                  <td>{r.quadraKills}</td>
                  <td class={r.pentaKills > 0 ? "gold" : ""}>{r.pentaKills}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <DecoCaption banter={pentakillBanter(rows)} />
    </>
  );
};

const WitchingHourPanel: FC<{ series: HourlySeries[] }> = ({ series }) => {
  if (series.length === 0) return <Empty title="No hourly data" />;
  const datasets = series.map((s, i) => ({
    label: s.displayName,
    borderColor: colorFor(i),
    backgroundColor: withAlpha(colorFor(i), 0.1),
    tension: 0.35,
    pointRadius: 2,
    borderWidth: 2,
    data: s.hourly.map((c) => (c.games >= 3 ? Math.round((c.wins / c.games) * 100) : null)),
    spanGaps: true,
  }));
  const config = {
    type: "line",
    data: {
      labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`),
      datasets,
    },
    options: {
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: "Winrate %" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={300} />
      <DecoCaption banter={witchingHourBanter(series)} />
    </>
  );
};

const ObjectivePanel: FC<{ rows: ObjectiveRow[] }> = ({ rows }) => {
  if (rows.length === 0) return <Empty title="No objective data" />;
  const labels = rows.map((r) => r.displayName);
  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Dragons", backgroundColor: colorFor(2), data: rows.map((r) => r.dragons) },
        { label: "Barons", backgroundColor: colorFor(3), data: rows.map((r) => r.barons) },
        { label: "Turrets", backgroundColor: colorFor(0), data: rows.map((r) => r.turrets) },
        { label: "Inhibitors", backgroundColor: colorFor(4), data: rows.map((r) => r.inhibitors) },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, title: { display: true, text: "Career totals" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  };
  return (
    <>
      <Chart config={config} height={320} />
      <DecoCaption banter={objectivesBanter(rows)} />
    </>
  );
};

const CrownPanel: FC<{ entries: CrownEntry[] }> = ({ entries }) => {
  if (entries.length === 0) return <Empty title="No daily sessions yet" />;
  return (
    <>
      <ol class="gatsby-crown-list">
        {entries.map((e) => (
          <li class="gatsby-crown-row">
            <span class="gatsby-crown-row__date">{e.dayKey}</span>
            <span class="gatsby-crown-row__mvp">
              <span class="gold">★ {e.mvpDisplayName ?? "—"}</span>
              <span class="muted">{e.mvpScore.toFixed(1)} pts</span>
            </span>
            {e.jesterDisplayName && e.jesterDisplayName !== e.mvpDisplayName ? (
              <span class="gatsby-crown-row__jester">
                <span>✕ {e.jesterDisplayName}</span>
                <span class="muted">{e.jesterScore.toFixed(1)} pts</span>
              </span>
            ) : (
              <span class="gatsby-crown-row__jester muted">—</span>
            )}
          </li>
        ))}
      </ol>
      <DecoCaption banter={crownBanter(entries)} />
    </>
  );
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export interface ComparePageProps {
  data: PavilionData;
  filters: CompareFilters;
}

export const CompareBody: FC<{ data: PavilionData }> = ({ data }) => (
  <div class="gatsby-grid">
    <DecoFrame index={1} kicker="Solo Queue LP over time" title="The Rank Race">
      <RankRacePanel data={data.rankRace} />
    </DecoFrame>

    <DecoFrame index={2} kicker="All-axes head-to-head" title="The Eight-Axis Duel">
      <RadarPanel data={data.radar} />
    </DecoFrame>

    <DecoFrame index={3} kicker="Winrate per pick × player" title="Champion Affairs">
      <ChampionAffairPanel data={data.champions} />
    </DecoFrame>

    <DecoFrame index={4} kicker="Winrate by team position" title="Lane Dominance">
      <LanePanel rows={data.lanes} />
    </DecoFrame>

    <DecoFrame index={5} kicker="Gold/min vs damage/min per match" title="The Gold Curve">
      <GoldCurvePanel series={data.goldCurve} />
    </DecoFrame>

    <DecoFrame index={6} kicker="Wards placed · killed · control, per game" title="Vision Society">
      <VisionPanel rows={data.vision} />
    </DecoFrame>

    <DecoFrame index={7} kicker="Career multikill ledger" title="Pentakill Pageant">
      <PentakillPanel rows={data.multikills} />
    </DecoFrame>

    <DecoFrame index={8} kicker="Winrate by hour of day" title="The Witching Hour">
      <WitchingHourPanel series={data.hourly} />
    </DecoFrame>

    <DecoFrame index={9} kicker="Dragons · barons · turrets · inhibitors" title="Objective Orchestra">
      <ObjectivePanel rows={data.objectives} />
    </DecoFrame>

    <DecoFrame index={10} kicker="Daily MVP from a composite score" title="Crown of the Evening">
      <CrownPanel entries={data.crowns} />
    </DecoFrame>
  </div>
);

export const ComparePage: FC<ComparePageProps> = ({ data, filters }) => (
  <div class="gatsby-page flex flex-col gap-6 pt-8">
    <header class="flex items-end justify-between gap-4 border-b border-border/40 pb-4">
      <div class="flex flex-col gap-1">
        <span class="scoreboard-eyebrow">FEED · 06 · COMPARISONS</span>
        <h1 class="font-display text-foreground text-4xl leading-none tracking-tight uppercase">
          Comparisons
        </h1>
        <p class="text-muted-foreground text-sm">
          Ten head-to-head graphs for the friend group. Captions are auto-written from the
          data — share the receipts, settle the arguments.
        </p>
      </div>
    </header>

    <Card>
      <CardContent>
        <form
          class="grid grid-cols-1 gap-4 md:grid-cols-3"
          hx-get="/fragments/compare"
          hx-target="#compare-body"
          hx-trigger="change"
          hx-push-url="true"
          hx-indicator="#compare-spinner"
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
              id="compare-spinner"
              class="htmx-indicator text-sm text-muted-foreground"
            >
              Loading…
            </span>
          </div>
        </form>
      </CardContent>
    </Card>

    <div id="compare-body">
      <CompareBody data={data} />
    </div>

    <ChartBoot />
  </div>
);
