import { MatchIcon, statIcon, eventIcon } from "../components/match-icon.js";
import type { FC } from "hono/jsx";
import type { MatchRaw } from "../../db/queries.js";
import { fmtClock } from "../lib/match-helpers.js";
import { championIcon, ddragonVersion } from "../lib/ddragon.js";
import { GRAPH_METRICS, matchGraphData, type GraphMetric } from "../lib/match-graphs.js";

export const MatchGraphs: FC<{ raw: MatchRaw; initialMetric?: GraphMetric }> = ({ raw, initialMetric = "damage" }) => {
  if (!raw.timeline) return <p class="text-muted-foreground p-8 text-center">No timeline data for this match.</p>;
  const data = matchGraphData(raw.match, raw.timeline, raw.trackedNames);
  if (!data.timestamps.length || !data.players.length) return <p class="text-muted-foreground p-8 text-center">No champion snapshots for this match.</p>;
  const version = ddragonVersion(raw.match.info.gameVersion);
  const focus = data.players.find(p=>p.tracked) ?? data.players[0]!;
  const rivals = data.players.filter(p=>p.teamId !== focus.teamId);
  const rival = rivals.find(p=>focus.role && p.role === focus.role) ?? rivals[0] ?? data.players.find(p=>p.id !== focus.id);
  const swings = data.teamGold.flatMap((v,i)=>v!=null && i>0 && data.teamGold[i-1]!=null ? [{value:v-data.teamGold[i-1]!,from:data.timestamps[i-1]!,to:data.timestamps[i]!}] : []);
  const swing = swings.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
  const metricName = `metric-${raw.match.metadata.matchId}`;
  return (
    <section class="match-graphs" data-match-graphs={JSON.stringify(data)} data-initial-metric={initialMetric} aria-label="Match graphs">
      <div class="analysis-intro"><span class="analysis-eyebrow">THE SHAPE OF THE MATCH</span><h2>Find the turning points</h2><p>Compare champions, follow the economy, and jump into the moments that mattered.</p></div>
      <div class="match-highlights">
        <div><span><MatchIcon name="clock" /> Duration</span><strong>{fmtClock(raw.match.info.gameDuration*1000)}</strong><small>{data.players.length} champions · {data.timestamps.length} snapshots</small></div>
        <div><span><MatchIcon name="gold" /> Largest gold swing between samples</span><strong>{swing ? `${swing.value>=0?'Blue':'Red'} +${Math.abs(swing.value).toLocaleString()}` : '—'}</strong><small>{swing ? `${fmtClock(swing.from)} → ${fmtClock(swing.to)}` : 'Not enough samples'}</small></div>
        <div><span><MatchIcon name="monster" /> Recorded epic monster kills</span><strong>{data.moments.filter(m=>m.kind==='objective').length}</strong><small>Dragons, Baron, Herald & grubs</small></div>
      </div>
      <fieldset class="graph-metrics">
        <legend class="sr-only">Graph metric</legend>
        {GRAPH_METRICS.map((metric) => <label>
          <input type="radio" name={metricName} value={metric.key} checked={initialMetric === metric.key} data-graph-metric data-description={metric.description} />
          <span><MatchIcon name={statIcon(metric.label)} /> {metric.label}</span>
        </label>)}
      </fieldset>
      <div class="graph-heading">
        <h3 data-graph-title>{GRAPH_METRICS.find((m) => m.key === initialMetric)?.label}</h3>
        <output data-graph-time aria-live="off"></output>
      </div>
      <p class="graph-description" data-graph-description></p>
      <p class="graph-description" data-graph-peaks hidden></p>
      <div class="graph-plot">
        <svg data-graph-svg viewBox="0 0 960 320" role="img" aria-label="Champion statistics over game time"></svg>
        <div id={`graph-tooltip-${raw.match.metadata.matchId}`} class="graph-tooltip" data-graph-tooltip role="tooltip" hidden></div>
        <p data-graph-empty hidden>No recorded values for this selection.</p>
      </div>
      <div class="graph-playback"><button type="button" data-graph-play aria-pressed="false"><MatchIcon name="play" /> Play timeline</button><span>One snapshot per step · not a game replay</span></div>
      <label class="graph-scrubber">Inspect time
        <input type="range" data-graph-time-slider min="0" max={data.timestamps.length - 1} value={data.timestamps.length - 1} step="1" aria-label="Inspect game time" aria-describedby={`graph-tooltip-${raw.match.metadata.matchId}`} />
      </label>
      <section class="head-to-head" aria-label="Head-to-head comparison">
        <div class="comparison-controls"><h4><MatchIcon name="compare" /> Head to head</h4>
          <label>Champion<div class="compare-select"><img data-compare-portrait="focus" src={championIcon(version,focus.champion)} alt="" width="32" height="32"/><select data-compare-focus>{data.players.map(p=><option value={p.id} selected={p.id===focus.id}>{p.champion} — {p.name}</option>)}</select></div></label>
          <span class="compare-vs">VS</span><label>Compare with<div class="compare-select"><img data-compare-portrait="rival" src={rival ? championIcon(version,rival.champion) : undefined} hidden={!rival} alt="" width="32" height="32"/><select data-compare-rival>{data.players.map(p=><option value={p.id} selected={p.id===rival?.id}>{p.champion} — {p.name}</option>)}</select></div></label>
          <button type="button" data-compare-isolate><MatchIcon name="compare" /> Show this pair</button>
        </div>
        <p data-compare-caption class="graph-description"></p><div class="comparison-values" data-compare-values></div>
        <details class="comparison-checkpoints"><summary>Nearest samples to 10, 15 & 20 minutes</summary><div data-compare-checkpoints></div></details>
      </section>
      <div class="graph-presets" data-graph-presets>
        <span>Show champions</span>
        <button type="button" data-graph-preset="all">All</button>
        {data.players.some((p) => p.tracked) && <button type="button" data-graph-preset="tracked">Tracked</button>}
        <button type="button" data-graph-preset="100">Blue team</button>
        <button type="button" data-graph-preset="200">Red team</button>
      </div>
      <div class="graph-roster">
        {[...new Set(data.players.map((p) => p.teamId))].map((teamId) => <fieldset>
          <legend>{teamId === 100 ? "Blue team" : teamId === 200 ? "Red team" : `Team ${teamId}`}</legend>
          {data.players.filter((p) => p.teamId === teamId).map((p) => <label class="graph-player" style={`--series-color:${p.color}`}>
            <input type="checkbox" checked data-graph-player={p.id} aria-label={`${p.champion} — ${p.name}`} />
            <img src={championIcon(version, p.champion)} alt="" width="32" height="32" loading="lazy" />
            <span class="graph-player-name"><strong>{p.champion}</strong><small>{p.name}{p.tracked ? " · tracked" : ""}</small></span>
            <output data-graph-value={p.id} aria-live="off">—</output>
          </label>)}
        </fieldset>)}
      </div>
      <section class="key-moments"><div class="graph-heading"><h3><MatchIcon name="clock" /> Key moments</h3><span class="analysis-eyebrow">JUMP TO A SNAPSHOT</span></div>
        <p class="graph-description">Event times are exact; clicking selects the nearest recorded snapshot.</p>
        <div class="moment-list">{data.moments.map(m=><button type="button" data-graph-moment={m.timestamp} style={`--moment-color:${m.teamId===100?'#38bdf8':'#fb7185'}`}><div class="moment-meta"><MatchIcon name={eventIcon(m.kind)} /><time>{fmtClock(m.timestamp)}</time>{m.actorChampion && <img src={championIcon(version,m.actorChampion)} alt="" width="24" height="24" loading="lazy" title={m.actorChampion}/>}</div><span>{m.text}</span></button>)}</div>
      </section>
      <p class="graph-footnote">Focus the time slider and use arrow keys, or hover over the graph or move the time slider to compare champions at the same moment. Recorded snapshots are roughly one minute apart. Gaps mean unavailable data.</p>
      <noscript>Enable JavaScript to explore these graphs. The Stats tab contains the final match statistics.</noscript>
    </section>
  );
};
