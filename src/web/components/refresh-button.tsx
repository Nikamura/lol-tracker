import type { FC } from "hono/jsx";
import type { RefreshState, RefreshSummary } from "../refresh.js";
import { cn } from "../lib/cn.js";

const baseClass =
  "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-mono uppercase tracking-[0.14em] transition-colors " +
  "border-border/70 bg-background/60 text-foreground hover:bg-accent hover:text-accent-foreground " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background/60 disabled:hover:text-foreground";

const Icon: FC<{ spinning?: boolean }> = ({ spinning }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    class={cn("size-3.5", spinning && "animate-spin")}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L14 6" />
    <path d="M14 2v4h-4" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2 10" />
    <path d="M2 14v-4h4" />
  </svg>
);

function summaryTitle(s: RefreshSummary | null): string {
  if (!s) return "Pull new matches from Riot";
  const when = new Date(s.ranAt).toUTCString();
  const bits = [`+${s.newMatches} matches`, `+${s.newTimelines} timelines`];
  if (s.errors) bits.push(`${s.errors} error(s)`);
  return `Last refresh: ${bits.join(", ")} — ${when}`;
}

export const REFRESH_BUTTON_ID = "refresh-button";

export const RefreshButton: FC<{ state: RefreshState }> = ({ state }) => {
  if (state.kind === "disabled") {
    return (
      <button
        id={REFRESH_BUTTON_ID}
        type="button"
        disabled
        class={baseClass}
        title={state.reason}
        aria-label={`Refresh unavailable — ${state.reason}`}
      >
        <Icon />
        <span>Refresh off</span>
      </button>
    );
  }

  if (state.kind === "running") {
    return (
      <button
        id={REFRESH_BUTTON_ID}
        type="button"
        disabled
        class={baseClass}
        hx-get="/fragments/refresh-button"
        hx-trigger="every 2s"
        hx-target="this"
        hx-swap="outerHTML"
        aria-busy="true"
        title="Pulling new matches from Riot…"
      >
        <Icon spinning />
        <span>Refreshing…</span>
      </button>
    );
  }

  if (state.kind === "cooldown") {
    const sec = Math.max(1, Math.ceil(state.remainingMs / 1000));
    return (
      <button
        id={REFRESH_BUTTON_ID}
        type="button"
        disabled
        class={baseClass}
        hx-get="/fragments/refresh-button"
        hx-trigger={`every 1s, load delay:${state.remainingMs}ms`}
        hx-target="this"
        hx-swap="outerHTML"
        title={summaryTitle(state.lastResult)}
      >
        <Icon />
        <span>
          Wait <span class="tabular-nums">{sec}s</span>
        </span>
      </button>
    );
  }

  return (
    <button
      id={REFRESH_BUTTON_ID}
      type="button"
      class={baseClass}
      hx-post="/refresh"
      hx-target="this"
      hx-swap="outerHTML"
      title={summaryTitle(state.lastResult)}
    >
      <Icon />
      <span>Refresh</span>
    </button>
  );
};
