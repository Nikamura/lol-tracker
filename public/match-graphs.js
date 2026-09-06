(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const clock = ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const format = n => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  function svgNode(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const itemCatalogs = new Map();
  // History snapshots serialize HTML, but cannot preserve event listeners.
  const graphPanels = new WeakSet();
  const championPanels = new WeakSet();
  const eventPanels = new WeakSet();
  let dismissHover = null;
  function catalog(version) {
    if (!itemCatalogs.has(version)) itemCatalogs.set(version,
      fetch('https://ddragon.leagueoflegends.com/cdn/' + encodeURIComponent(version) + '/data/en_US/item.json')
        .then(r => { if (!r.ok) throw new Error('Item catalog unavailable'); return r.json(); })
        .then(json => json.data).catch(() => null));
    return itemCatalogs.get(version);
  }
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function hydrate(root) {
    root.querySelectorAll('[data-champion-analysis]').forEach(panel => {
      if (championPanels.has(panel)) return;
      championPanels.add(panel);
      panel.addEventListener('click', event => {
        const button = event.target.closest('[data-champion-pick]');
        if (!button) return;
        panel.querySelectorAll('[data-champion-pick]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        panel.querySelectorAll('[data-champion-panel]').forEach(p => { p.hidden = p.dataset.championPanel !== button.dataset.championPick; });
      });
      catalog(panel.dataset.itemVersion).then(items => {
        if (!items || !panel.isConnected) return;
        panel.querySelectorAll('[data-item-name]').forEach(node => {
          const name = items[node.dataset.itemName]?.name;
          if (typeof name === 'string') node.textContent = name;
        });
      });
    });
    root.querySelectorAll('[data-match-graphs]').forEach(panel => {
      if (graphPanels.has(panel)) return;
      const data = JSON.parse(panel.dataset.matchGraphs);
      graphPanels.add(panel);
      const svg = panel.querySelector('[data-graph-svg]');
      const slider = panel.querySelector('[data-graph-time-slider]');
      // An older HTMX history entry may predate the tooltip markup.
      let tooltip = panel.querySelector('[data-graph-tooltip]');
      if (!tooltip) {
        tooltip = element('div', undefined, 'graph-tooltip');
        tooltip.dataset.graphTooltip = '';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.hidden = true;
        svg.parentElement.append(tooltip);
      }
      const checks = [...panel.querySelectorAll('[data-graph-player]')];
      let metric = panel.dataset.initialMetric;
      let index = data.timestamps.length - 1;
      let visibleSeries = [];
      let playing = null;
      const playButton = panel.querySelector('[data-graph-play]');
      const focusSelect = panel.querySelector('[data-compare-focus]');
      const rivalSelect = panel.querySelector('[data-compare-rival]');
      const nearest = ms => data.timestamps.reduce((best,t,i) => Math.abs(t-ms)<Math.abs(data.timestamps[best]-ms)?i:best, 0);
      function stop() {
        clearInterval(playing); playing = null;
        playButton.textContent = '▶ Play timeline';
        playButton.setAttribute('aria-pressed', 'false');
      }
      function compare() {
        const a = data.players.find(p=>p.id===Number(focusSelect.value));
        const b = data.players.find(p=>p.id===Number(rivalSelect.value));
        const same = !a || !b || a.id===b.id;
        panel.querySelector('[data-compare-isolate]').disabled = same;
        panel.querySelector('[data-compare-caption]').textContent = same ? 'Choose two different champions.' : a.champion + ' minus ' + b.champion + ' at ' + clock(data.timestamps[index]);
        const container = panel.querySelector('[data-compare-values]');
        container.replaceChildren();
        for (const [key,label] of [['gold','Gold'],['cs','CS'],['xp','XP'],['level','Level']]) {
          const av = a?.values[key][index], bv = b?.values[key][index];
          const delta = same || av == null || bv == null ? null : av-bv;
          const card = element('div', undefined, 'comparison-stat');
          card.append(element('span',label),element('strong',delta==null?'—':(delta>0?'+':'')+format(delta)),element('small',format(av)+' vs '+format(bv)));
          container.append(card);
        }
        const checkpoints = panel.querySelector('[data-compare-checkpoints]');
        const table = element('table');
        const header = element('tr');
        for (const label of ['Sample','Gold Δ','CS Δ','XP Δ']) header.append(element('th',label));
        const thead = element('thead'); thead.append(header); table.append(thead);
        const body = element('tbody');
        for (const minute of [10,15,20]) {
          const ms=minute*60000;
          // Riot's minute snapshots often land a few milliseconds after the minute.
          // Use the nearest observed snapshot, and show its actual time in the table.
          const sample=nearest(ms);
          const reached = data.timestamps[data.timestamps.length-1]>=ms;
          const valid = reached && Math.abs(ms-data.timestamps[sample])<=30000;
          const row=element('tr');
          row.append(element('th',valid?clock(data.timestamps[sample]):minute+':00 · '+(reached?'unavailable':'not reached')));
          for(const key of ['gold','cs','xp']) {
            const av=valid?a?.values[key][sample]:null,bv=valid?b?.values[key][sample]:null;
            const delta=same||av==null||bv==null?null:av-bv;
            row.append(element('td',delta==null?'—':(delta>0?'+':'')+format(delta)));
          }
          body.append(row);
        }
        table.append(body); checkpoints.replaceChildren(table);
      }
      let cursor, dots, x, y;
      const left = 54, top = 20;
      let right = 942, bottom = 278, previousWidth = 0;
      const end = Math.max(1, data.timestamps[data.timestamps.length - 1]);
      x = ms => left + ms / end * (right - left);
      function hideHover() {
        if (dismissHover === hideHover) dismissHover = null;
        tooltip.hidden = true;
        svg.querySelectorAll('[data-graph-series]').forEach(path => {
          path.setAttribute('opacity', '1'); path.setAttribute('stroke-width', '2.5');
        });
      }
      function showHover(point) {
        if (point.x < left || point.x > right || point.y < top || point.y > bottom) { hideHover(); return; }
        const rows = visibleSeries.filter(series => series.values[index] != null);
        if (!rows.length) { hideHover(); return; }
        // Hit-test the drawn segment, not just the nearest minute's endpoint.
        const ms = (point.x - left) / (right - left) * end;
        let after = data.timestamps.findIndex(t => t >= ms);
        if (after < 0) after = data.timestamps.length - 1;
        const before = Math.max(0, after - 1);
        let focused = null, distance = 18;
        for (const series of rows) {
          const a = series.values[before], b = series.values[after];
          if (a == null || b == null) continue;
          const span = data.timestamps[after] - data.timestamps[before];
          const fraction = span ? (ms-data.timestamps[before])/span : 0;
          const value = metric === 'level' && fraction < 1 ? a : a+(b-a)*fraction;
          const d = Math.abs(y(value)-point.y);
          if (d < distance) { distance=d; focused=series; }
        }
        tooltip.replaceChildren(element('strong', panel.querySelector('[data-graph-title]').textContent + ' · ' + clock(data.timestamps[index]), 'graph-tooltip-heading'));
        for (const series of rows.slice().sort((a,b)=>b.values[index]-a.values[index])) {
          const value = series.values[index];
          const row = element('div', undefined, 'graph-tooltip-row' + (series===focused?' is-focused':''));
          row.style.setProperty('--series-color', series.color);
          row.append(element('i'));
          const identity = series.player ? series.player.champion+' · '+series.player.name
            : value === 0 ? 'Teams even' : (value>0?'Blue':'Red')+' team ahead';
          const label = element('span',identity); label.title=identity;
          row.append(label,element('b',format(metric==='teamGold'?Math.abs(value):value)));
          tooltip.append(row);
        }
        svg.querySelectorAll('[data-graph-series]').forEach(path => {
          const selected = focused && path.dataset.graphSeries === String(focused.player?.id ?? 'teamGold');
          path.setAttribute('opacity',focused && !selected ? '.25' : '1');
          path.setAttribute('stroke-width',selected?'4':'2.5');
        });
        if (dismissHover && dismissHover !== hideHover) dismissHover();
        dismissHover = hideHover;
        tooltip.hidden=false;
        // Place beside the pointer and keep the panel within the chart, including on phones.
        const rect=svg.getBoundingClientRect(), view=svg.viewBox.baseVal;
        const px=point.x/view.width*rect.width, py=point.y/view.height*rect.height;
        const tx=px+16+tooltip.offsetWidth<=rect.width?px+16:px-tooltip.offsetWidth-16;
        tooltip.style.left=Math.max(4,Math.min(tx,rect.width-tooltip.offsetWidth-4))+'px';
        tooltip.style.top=Math.max(4,Math.min(py+12,rect.height-tooltip.offsetHeight-4))+'px';
      }
      function inspect(next) {
        hideHover();
        index = next;
        slider.value = String(index);
        compare();
        panel.querySelectorAll('button[data-graph-moment]').forEach(button => button.setAttribute('aria-pressed',String(nearest(Number(button.dataset.graphMoment))===index)));
        slider.setAttribute('aria-valuetext', clock(data.timestamps[index]));
        panel.querySelector('[data-graph-time]').textContent = clock(data.timestamps[index]);
        for (const p of data.players) {
          // Team gold lead always displays each champion's total gold alongside it.
          panel.querySelector('[data-graph-value="' + p.id + '"]').textContent = format(p.values[metric === 'teamGold' ? 'gold' : metric][index]);
        }
        cursor.setAttribute('x1', x(data.timestamps[index]));
        cursor.setAttribute('x2', x(data.timestamps[index]));
        dots.replaceChildren();
        for (const series of visibleSeries) {
          const value = series.values[index];
          if (value != null) dots.append(svgNode('circle', { cx: x(data.timestamps[index]), cy: y(value), r: 4, fill: series.color, stroke: 'var(--background)', 'stroke-width': 2 }));
        }
        if (metric === 'teamGold') {
          const value = data.teamGold[index];
          panel.querySelector('[data-graph-time]').textContent += value == null ? ' · unavailable' : ' · ' + (value === 0 ? 'Even' : (value > 0 ? 'Blue' : 'Red') + ' +' + format(Math.abs(value)) + ' gold');
        }
      }
      function draw() {
        const width = Math.max(280, svg.getBoundingClientRect().width);
        previousWidth = width;
        const height = width < 600 ? 260 : 320;
        right = width - 18; bottom = height - 36;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.height = height + 'px';
        const radio = panel.querySelector('[data-graph-metric]:checked');
        metric = radio.value;
        const team = metric === 'teamGold';
        panel.querySelector('[data-graph-title]').textContent = radio.nextElementSibling.textContent;
        panel.querySelector('[data-graph-description]').textContent = radio.dataset.description;
        svg.setAttribute('aria-label', radio.nextElementSibling.textContent + ' over game time');
        panel.querySelector('[data-graph-presets]').hidden = team;
        const peaks = panel.querySelector('[data-graph-peaks]');
        peaks.hidden = !team;
        if (team) {
          const observed = data.teamGold.map((v, i) => ({ v, i })).filter(p => p.v != null);
          const blue = observed.reduce((best, p) => p.v > best.v ? p : best, { v: 0, i: 0 });
          const red = observed.reduce((best, p) => p.v < best.v ? p : best, { v: 0, i: 0 });
          peaks.textContent = observed.length
            ? 'Blue peak: ' + format(blue.v) + (blue.v ? ' at ' + clock(data.timestamps[blue.i]) : '')
              + ' · Red peak: ' + format(-red.v) + (red.v ? ' at ' + clock(data.timestamps[red.i]) : '')
              + ' · Champion values below show total gold.'
            : 'No complete team gold samples.';
        }
        for (const check of checks) check.disabled = team;
        visibleSeries = team
          ? [{ color: '#c6f36a', values: data.teamGold }]
          : data.players.filter(p => checks.find(c => Number(c.dataset.graphPlayer) === p.id).checked)
            .map(p => ({ color: p.color, values: p.values[metric], teamId: p.teamId, player: p }));
        const values = visibleSeries.flatMap(s => s.values.filter(v => v != null));
        panel.querySelector('[data-graph-empty]').hidden = values.length > 0;
        panel.querySelector('[data-graph-empty]').textContent = visibleSeries.length ? 'No recorded values for this selection.' : 'Select at least one champion.';
        let min = Math.min(0, ...values), max = Math.max(1, ...values);
        if (team) { max = Math.max(Math.abs(min), max); min = -max; }
        else if (metric === 'level') max = Math.max(4, Math.ceil(max / 4) * 4);
        y = n => bottom - (n - min) / (max - min) * (bottom - top);
        svg.replaceChildren();
        for (let i = 0; i <= 4; i++) {
          const value = min + (max - min) * i / 4;
          const py = y(value);
          svg.append(svgNode('line', { x1: left, x2: right, y1: py, y2: py, stroke: 'currentColor', opacity: value === 0 ? .4 : .12 }));
          const label = Math.abs(value) >= 1000 ? (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(value));
          svg.append(svgNode('text', { x: left - 10, y: py + 4, 'text-anchor': 'end', fill: 'currentColor' }, label));
        }
        const ticks = width < 600 ? 3 : 6;
        for (let i = 0; i <= ticks; i++) {
          const ms = end * i / ticks;
          svg.append(svgNode('text', { x: x(ms), y: bottom + 25, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle', fill: 'currentColor' }, clock(ms)));
        }
        for (const series of visibleSeries) {
          let d = '', prev = null;
          series.values.forEach((v, i) => {
            if (v == null) { prev = null; return; }
            const px = x(data.timestamps[i]), py = y(v);
            d += prev === null ? `M${px},${py}` : metric === 'level' ? `H${px}V${py}` : `L${px},${py}`;
            prev = v;
            // Isolated samples remain visible even when neighboring data is absent.
            if (series.values[i - 1] == null && series.values[i + 1] == null) svg.append(svgNode('circle', { cx: px, cy: py, r: 3, fill: series.color }));
          });
          svg.append(svgNode('path', { d, fill: 'none', stroke: series.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-dasharray': series.teamId === 200 ? '7 3' : 'none', 'data-graph-series': series.player?.id ?? 'teamGold' }));
        }
        for (const moment of data.moments.filter(m=>m.kind==='objective')) {
          const marker = svgNode('circle', {cx:x(moment.timestamp),cy:top+5,r:4,fill:moment.teamId===100?'#38bdf8':'#fb7185','data-graph-moment':moment.timestamp});
          marker.append(svgNode('title',{},clock(moment.timestamp)+' · '+moment.text));
          svg.append(marker);
        }
        cursor = svgNode('line', { y1: top, y2: bottom, stroke: 'currentColor', opacity: .5, 'stroke-dasharray': '3 4' });
        dots = svgNode('g', {});
        svg.append(cursor, dots);
        inspect(index);
      }
      panel.addEventListener('change', event => {
        if (event.target.matches('[data-compare-focus], [data-compare-rival]')) { compare(); return; }
        if (event.target.matches('[data-graph-metric], [data-graph-player]')) draw();
      });
      panel.addEventListener('click', event => {
        const moment = event.target.closest('[data-graph-moment]');
        if (moment) { stop(); inspect(nearest(Number(moment.dataset.graphMoment))); return; }
        if (event.target.closest('[data-compare-isolate]')) {
          for (const check of checks) check.checked = [focusSelect.value,rivalSelect.value].includes(check.dataset.graphPlayer);
          if (metric==='teamGold') panel.querySelector('[data-graph-metric][value="gold"]').checked=true;
          draw(); return;
        }
        const button = event.target.closest('[data-graph-preset]');
        if (!button) return;
        const preset = button.dataset.graphPreset;
        for (const check of checks) {
          const p = data.players.find(p => p.id === Number(check.dataset.graphPlayer));
          check.checked = preset === 'all' || (preset === 'tracked' ? p.tracked : p.teamId === Number(preset));
        }
        draw();
      });
      playButton.addEventListener('click', () => {
        if (playing) { stop(); return; }
        if(index===data.timestamps.length-1) inspect(0);
        playButton.textContent='Ⅱ Pause'; playButton.setAttribute('aria-pressed','true');
        playing=setInterval(()=>{
          if(!panel.isConnected || document.hidden || index>=data.timestamps.length-1) {stop(); return;}
          inspect(index+1);
          if(index===data.timestamps.length-1) stop();
        },650);
      });
      slider.addEventListener('input', () => {stop(); inspect(Number(slider.value));});
      function pointerHover(event) {
        if (playing) return;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const ms = Math.max(0, Math.min(end, (point.x - left) / (right - left) * end));
        let nearest = 0;
        data.timestamps.forEach((t, i) => { if (Math.abs(t - ms) < Math.abs(data.timestamps[nearest] - ms)) nearest = i; });
        inspect(nearest);
        showHover(point);
      }
      svg.addEventListener('pointermove', pointerHover);
      svg.addEventListener('pointerdown', pointerHover);
      svg.addEventListener('pointerleave', hideHover);
      draw();
      // Observe the panel so embedded match rows and narrow screens keep legible axes.
      const observer = new ResizeObserver(() => {
        if (!panel.isConnected) { observer.disconnect(); hideHover(); return; }
        if (Math.abs(svg.getBoundingClientRect().width - previousWidth) > 1) draw();
      });
      observer.observe(panel);
      panel.addEventListener('htmx:beforeCleanupElement', () => {observer.disconnect();stop();hideHover();}, { once: true });
    });
    root.querySelectorAll('[data-match-events]').forEach(panel => {
      if (eventPanels.has(panel)) return;
      eventPanels.add(panel);
      function applyFilters() {
        const player = panel.querySelector('select[data-event-player]').value;
        const kind = panel.querySelector('select[data-event-kind]').value;
        let count = 0;
        panel.querySelectorAll('[data-event-row]').forEach(row => {
          const show = (player === 'all' || row.dataset.eventPlayers.split(' ').includes(player))
            && (kind === 'all' || kind.split(' ').includes(row.dataset.eventKind));
          row.hidden = !show;
          if (show) count++;
        });
        panel.querySelector('[data-events-empty]').hidden = count !== 0;
      }
      panel.addEventListener('change', applyFilters);
      applyFilters();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate(document));
  else hydrate(document);
  document.addEventListener('htmx:afterSwap', event => hydrate(event.target.parentElement || document));
  document.addEventListener('htmx:historyRestore', () => hydrate(document));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && dismissHover) dismissHover(); });
})();
