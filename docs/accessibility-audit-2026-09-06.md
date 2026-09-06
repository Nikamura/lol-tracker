# Accessibility audit — 6 September 2026

## Coverage and method

Audited the populated local tracker with axe-core 4.13.0 in Chrome. Ran WCAG 2 A/AA, WCAG 2.1 AA, WCAG 2.2 AA, and best-practice rules against the real rendered pages in same-origin frames at 1280px and 390px widths. The temporary runner and axe bundle are not included in production.

The 13 views were Timeline, Daily, Leaderboards, Streaks, Heatmaps, Comparisons, Players, a populated player profile, and all five match tabs (Overview, Stats, Timeline, Champions, Graphs) for `EUW1_7975057980`.

Final automated result: **zero violations across all 26 page/width combinations**. A further incomplete ARIA check on the champion picker was investigated and fixed by adding its missing group role.

## Corrections

- Restored deliberate zoom. Kept 16px mobile form controls to avoid focus auto-zoom and kept nested horizontal scrolling. The previous `user-scalable=no` and touch restrictions were incompatible with accessible magnification.
- Added a skip link, named primary navigation, current-page state, a main focus target, missing page headings, and a consistent section heading hierarchy.
- Raised muted text contrast, removed opacity from meaningful metadata, corrected loss/death colors and small-sample heatmap values, and gave text panels stable backgrounds.
- Added named tab panels, arrow/Home/End navigation, a single tab stop, and focus restoration after HTMX replacement. Unavailable timeline links fall back to Overview so disabled tabs cannot leave keyboard users stranded.
- Made graph tooltips available from the time slider, dismissible with Escape, and hoverable. Existing portraits, names, sampled times, and values remain available.
- Added expandable semantic data tables for comparison charts and activity heatmaps. Horizontal chart labels correctly follow the category/value axes; date axes identify UTC.
- Made overflowing data areas keyboard focusable and gave skill-upgrade tiles descriptive text alternatives.
- Corrected empty table headers, invalid player-profile definition-list markup, repeated portrait alternative text, and the champion-picker group name.
- Respected reduced-motion preferences in CSS and Chart.js, and reinitialized comparison charts on history restoration.

## Verification

- `pnpm build`, `pnpm smoke`, `pnpm typecheck`, and `node --check public/match-graphs.js`.
- Regression checks for unavailable-tab keyboard entry, horizontal chart table headings, and escaped table values.
- Keyboard-only skip-link activation, arrow-key tab activation, focus surviving the asynchronous swap, slider value inspection, and Escape dismissal.
- Comparison data table opened without using chart hover; displayed values verified against the rendered configuration.
- Reduced-motion emulation disabled the live-dot animation. Browser page-scale emulation reached 2× and was reset afterward. Width-based reflow was audited separately at 390px.
- `autoreview --mode local`; accepted findings about disabled-tab focus and horizontal-axis semantics were corrected and reviewed again.

## Limits

This is an automated audit plus focused interaction testing, not a declaration of full WCAG conformance. Axe still marks some contrast cases as inconclusive for clipped/offscreen content, short glyphs, decorative pseudo-elements, and remaining gradients. Canvas pixels are not exhaustively contrast-tested; accessible data tables provide a nonvisual equivalent. No complete VoiceOver/NVDA session, physical iOS pinch test, or exhaustive state/data combination was run.

References: [WCAG text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [ARIA tabs keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
