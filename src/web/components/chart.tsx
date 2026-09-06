import type { FC } from "hono/jsx";

/**
 * Server-emitted Chart.js wrapper.
 *
 * Renders a `<canvas data-chart='{...}'>` element. A one-time bootstrap script
 * (see `ChartBoot`) walks every `[data-chart]` canvas in the document, parses
 * its JSON config, and hands it to Chart.js (loaded via CDN). This keeps the
 * server-rendered Hono+JSX architecture intact — no bundler, no hydration.
 */
export interface ChartProps {
  /** Chart.js config: `{ type, data, options }`. */
  config: unknown;
  /** Canvas height in px (responsive width fills the container). */
  height?: number;
  class?: string;
}

export const Chart: FC<ChartProps> = ({ config, height = 280, class: cls }) => {
  const json = JSON.stringify(config);
  // These configurations are assembled by our server-side comparison panels.
  const chart = config as {
    type?: string;
    data?: { labels?: unknown[]; datasets?: Array<{label?: string; data?: unknown[]}> };
    options?: { indexAxis?: string; scales?: Record<string, {type?: string; title?: {text?: string}}> };
  };
  const horizontal = chart.options?.indexAxis === "y";
  const xScale = chart.options?.scales?.[horizontal ? "y" : "x"];
  const xTitle = xScale?.type === "time" ? "Date (UTC)" : xScale?.title?.text ?? "Category";
  const yTitle = chart.options?.scales?.[horizontal ? "x" : "y"]?.title?.text ?? "Value";
  const rows = (chart.data?.datasets ?? []).flatMap((series, seriesIndex) => (series.data ?? []).map((point, index) => {
    const xy = point != null && typeof point === "object" ? point as {x?: unknown; y?: unknown} : null;
    const x = xy ? xy.x : chart.data?.labels?.[index] ?? index + 1;
    const date = xScale?.type === "time" && (typeof x === "number" || typeof x === "string") ? new Date(x) : null;
    return { series: series.label ?? `Series ${seriesIndex + 1}`, x: date && Number.isFinite(date.getTime()) ? date.toISOString() : String(x ?? "—"), y: String((xy ? xy.y : point) ?? "Unavailable") };
  }));
  return (
    <>
      <div class={`gatsby-chart-frame ${cls ?? ""}`} style={`height: ${height}px;`}>
        <canvas data-chart={json} role="img" aria-label={`${chart.type ?? "Data"} chart. ${yTitle} by ${xTitle}. Full values in the chart data table below.`}></canvas>
      </div>
      <details class="accessible-chart-data"><summary>View chart data</summary>
        <div class="scroll-x" tabindex={0} role="group" aria-label="Chart data, scroll horizontally">
          <table><caption>{yTitle} by {xTitle}</caption><thead><tr><th scope="col">Series</th><th scope="col">{xTitle}</th><th scope="col">{yTitle}</th></tr></thead>
            <tbody>{rows.map(row=><tr><th scope="row">{row.series}</th><td>{row.x}</td><td>{row.y}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>
  );
};

/**
 * Inject Chart.js + the boot script that walks `[data-chart]` canvases.
 * Drop this once per page that uses `<Chart>`.
 */
export const ChartBoot: FC = () => {
  const boot = `
(function(){
  function hydrate(root){
    if (typeof window.Chart === 'undefined') { setTimeout(function(){ hydrate(root); }, 50); return; }
    var fg = getComputedStyle(document.body).getPropertyValue('--gatsby-ink') || '#f4ecd8';
    var grid = 'rgba(212,175,55,0.18)';
    var muted = 'rgba(244,236,216,0.55)';
    window.Chart.defaults.color = fg.trim();
    window.Chart.defaults.borderColor = grid;
    window.Chart.defaults.font.family = "'Cinzel', 'Playfair Display', 'IBM Plex Sans', serif";
    window.Chart.defaults.font.size = 11;
    var scope = root && root.querySelectorAll ? root : document;
    var canvases = scope.querySelectorAll('canvas[data-chart]');
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      if (window.Chart.getChart(c)) continue;
      try {
        var cfg = JSON.parse(c.getAttribute('data-chart'));
        cfg.options = cfg.options || {};
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) cfg.options.animation=false;
        cfg.options.responsive = true;
        cfg.options.maintainAspectRatio = false;
        cfg.options.plugins = cfg.options.plugins || {};
        cfg.options.plugins.legend = cfg.options.plugins.legend || {};
        cfg.options.plugins.legend.labels = Object.assign(
          { color: fg.trim(), font: { family: window.Chart.defaults.font.family } },
          cfg.options.plugins.legend.labels || {}
        );
        // Tint scales
        if (cfg.options.scales) {
          for (var k in cfg.options.scales) {
            var s = cfg.options.scales[k] = cfg.options.scales[k] || {};
            s.grid = Object.assign({ color: grid }, s.grid || {});
            s.ticks = Object.assign({ color: muted }, s.ticks || {});
            if (s.angleLines) s.angleLines = Object.assign({ color: grid }, s.angleLines);
            if (s.pointLabels) s.pointLabels = Object.assign({ color: fg.trim() }, s.pointLabels);
          }
        }
        new window.Chart(c.getContext('2d'), cfg);
        c.dataset.hydrated = '1';
      } catch (e) { console.error('chart hydrate failed', e); }
    }
  }
  if (document.readyState !== 'loading') hydrate(document);
  else document.addEventListener('DOMContentLoaded', function(){ hydrate(document); });
  // Destroy doomed charts before htmx swaps the subtree, then re-hydrate.
  // Without this, Chart.js v4 throws "Canvas is already in use" if the same
  // canvas survives the swap, and orphaned instances accumulate otherwise.
  document.body.addEventListener('htmx:beforeSwap', function(e){
    if (typeof window.Chart === 'undefined' || !e.target || !e.target.querySelectorAll) return;
    var olds = e.target.querySelectorAll('canvas[data-chart]');
    for (var i = 0; i < olds.length; i++) {
      var inst = window.Chart.getChart && window.Chart.getChart(olds[i]);
      if (inst) inst.destroy();
    }
  });
  document.body.addEventListener('htmx:historyRestore', function(){ hydrate(document); });
  document.body.addEventListener('htmx:afterSwap', function(e){ hydrate(e.target || document); });
})();
`;
  return (
    <>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js" defer></script>
      {/* Date adapter — required for any chart using a `time` scale (e.g. LP-over-time). */}
      <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js" defer></script>
      <script defer dangerouslySetInnerHTML={{ __html: boot }}></script>
    </>
  );
};
