import type { FC } from "hono/jsx";
import type { TimelineRow } from "../../db/queries.js";
import { isArena, queueLabel } from "../../lib/queues.js";
import {
  championIcon,
  ddragonVersion,
  itemIcon,
  runeTreeIcon,
  runeTreeLabel,
  summonerSpellIcon,
} from "../lib/ddragon.js";
import { cn } from "../lib/cn.js";
import { Badge } from "./ui.js";

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const datePart = sameDay
    ? "today"
    : d.toLocaleDateString("en-CA", { month: "2-digit", day: "2-digit" });
  const timePart = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

function csOf(row: TimelineRow): number {
  return (row.totalMinionsKilled ?? 0) + (row.neutralMinionsKilled ?? 0);
}

function csPerMin(row: TimelineRow): string {
  if (row.gameDuration <= 0) return "—";
  const cspm = (csOf(row) / row.gameDuration) * 60;
  return cspm.toFixed(1);
}

function gpm(row: TimelineRow): string {
  if (row.gameDuration <= 0 || row.goldEarned == null) return "—";
  return String(Math.round((row.goldEarned / row.gameDuration) * 60));
}

function kdaRatio(row: TimelineRow): string {
  if (row.deaths === 0) return "Perfect";
  return ((row.kills + row.assists) / row.deaths).toFixed(2);
}

export function isRemake(row: TimelineRow): boolean {
  return Boolean(row.teamEarlySurrendered) && row.gameDuration < 300;
}

function deriveBadges(row: TimelineRow): Array<{ label: string; variant: "secondary" | "outline" | "destructive" | "success" }> {
  const out: Array<{ label: string; variant: "secondary" | "outline" | "destructive" | "success" }> = [];
  if ((row.pentaKills ?? 0) > 0) out.push({ label: "Pentakill", variant: "success" });
  else if ((row.quadraKills ?? 0) > 0) out.push({ label: "Quadra Kill", variant: "success" });
  else if ((row.tripleKills ?? 0) > 0) out.push({ label: "Triple Kill", variant: "secondary" });
  else if ((row.doubleKills ?? 0) > 0) out.push({ label: "Double Kill", variant: "outline" });
  if (row.firstBloodKill) out.push({ label: "First Blood", variant: "outline" });
  if (isRemake(row)) return out;
  if (row.teamEarlySurrendered) out.push({ label: "Early FF", variant: "destructive" });
  else if (row.gameEndedInSurrender) out.push({ label: "Surrender", variant: "outline" });
  return out;
}

const RAIL: Record<"win" | "loss" | "remake", string> = {
  win: "before:bg-success/70 bg-gradient-to-r from-success/[0.08] via-card to-card",
  loss: "before:bg-destructive/80 bg-gradient-to-r from-destructive/[0.08] via-card to-card",
  remake: "before:bg-muted-foreground/40 bg-card",
};

const POSITION_LABEL: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

function positionLabel(raw: string | null): string | null {
  if (!raw || raw === "Invalid" || raw === "INVALID" || raw === "NONE") return null;
  return POSITION_LABEL[raw] ?? raw;
}

export interface MatchRowProps {
  row: TimelineRow;
  /** Show the player's name above the champion cluster (useful on parties view). */
  showPlayer?: boolean;
  /**
   * Render a compact variant: skip the outcome cluster and the per-row
   * expand. Used inside a party group where the parent already shows the
   * shared match metadata and owns a single expand.
   */
  embedded?: boolean;
}

export const MatchRow: FC<MatchRowProps> = ({ row, showPlayer = true, embedded = false }) => {
  const ver = ddragonVersion(row.gameVersion);
  const remake = isRemake(row);
  const outcome: "win" | "loss" | "remake" = remake ? "remake" : row.win ? "win" : "loss";
  const badges = deriveBadges(row);
  const items = [row.item0, row.item1, row.item2, row.item3, row.item4, row.item5];
  const trinket = row.item6;
  const queue = queueLabel(row.queueId, row.gameMode);
  const arena = isArena(row.queueId, row.gameMode);
  const role = positionLabel(row.teamPosition);

  const gridCols = embedded
    ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]"
    : "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]";

  return (
    <article
      class={cn(
        "group relative overflow-hidden rounded-xl border",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        RAIL[outcome],
        !embedded && remake && "opacity-70",
      )}
    >
      <div class={cn("grid items-center gap-5 px-5 py-4 max-md:grid-cols-1", gridCols)}>
        <ChampionCluster
          version={ver}
          championName={row.championName}
          level={row.champLevel}
          role={role}
          playerName={showPlayer ? row.displayName ?? row.gameName : null}
        />

        {arena ? <span class="hidden md:block" /> : <KitCluster version={ver} row={row} />}

        <StatsCluster row={row} />

        <ItemsStrip version={ver} items={items} trinket={trinket} />

        {embedded ? null : (
          <OutcomeCluster
            outcome={outcome}
            queue={queue}
            when={fmtWhen(row.gameStart)}
            duration={fmtClock(row.gameDuration)}
          />
        )}
      </div>

      {badges.length > 0 ? (
        <div class="flex flex-wrap gap-2 px-5 pb-3">
          {badges.map((b) => (
            <Badge variant={b.variant}>{b.label}</Badge>
          ))}
        </div>
      ) : null}

      {embedded ? null : <MatchExpand matchId={row.matchId} />}
    </article>
  );
};

export const MatchExpand: FC<{ matchId: string; label?: string }> = ({
  matchId,
  label = "Show full match",
}) => (
  <details class="group/d border-t">
    <summary class="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-center gap-2 px-5 py-2 text-xs select-none">
      <span class="group-open/d:hidden">{label}</span>
      <span class="hidden group-open/d:inline">Hide</span>
      <svg
        class="size-3 transition-transform group-open/d:rotate-180"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </summary>
    <div
      class="border-t px-5 py-4"
      hx-get={`/fragments/match/${matchId}`}
      hx-trigger="toggle from:closest details once"
      hx-swap="innerHTML"
    >
      <p class="text-muted-foreground text-xs">Loading…</p>
    </div>
  </details>
);

const ChampionCluster: FC<{
  version: string;
  championName: string;
  level: number | null;
  role: string | null;
  playerName: string | null;
}> = ({ version, championName, level, role, playerName }) => (
  <div class="flex items-center gap-3">
    <div class="relative shrink-0">
      <img
        src={championIcon(version, championName)}
        alt={championName}
        class="size-14 rounded-lg ring-1 ring-border"
        loading="lazy"
      />
      {level != null ? (
        <span class="font-mono absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-card text-[10px] ring-1 ring-border">
          {level}
        </span>
      ) : null}
    </div>
    <div class="flex min-w-0 flex-col">
      {playerName ? (
        <span class="text-foreground truncate text-sm font-semibold tracking-tight">{playerName}</span>
      ) : null}
      <span class="text-muted-foreground truncate text-xs">{championName}</span>
      {role ? <span class="text-muted-foreground/70 text-[10px] uppercase tracking-wider">{role}</span> : null}
    </div>
  </div>
);

const KitCluster: FC<{ version: string; row: TimelineRow }> = ({ version, row }) => {
  const spell1 = summonerSpellIcon(version, row.summoner1Id);
  const spell2 = summonerSpellIcon(version, row.summoner2Id);
  const primary = runeTreeIcon(row.perksPrimaryStyle);
  const secondary = runeTreeIcon(row.perksSubStyle);
  const primaryLabel = runeTreeLabel(row.perksPrimaryStyle);
  const secondaryLabel = runeTreeLabel(row.perksSubStyle);
  return (
    <div class="flex shrink-0 items-center gap-1.5">
      <div class="flex flex-col gap-1">
        {spell1 ? (
          <img src={spell1} alt="" class="bg-card size-6 rounded ring-1 ring-border" loading="lazy" />
        ) : (
          <span class="bg-muted/40 size-6 rounded" />
        )}
        {spell2 ? (
          <img src={spell2} alt="" class="bg-card size-6 rounded ring-1 ring-border" loading="lazy" />
        ) : (
          <span class="bg-muted/40 size-6 rounded" />
        )}
      </div>
      <div class="flex flex-col gap-1">
        {primary ? (
          <img
            src={primary}
            alt={primaryLabel ?? ""}
            class="bg-background/60 size-6 rounded-full p-0.5 ring-1 ring-border"
            loading="lazy"
          />
        ) : (
          <span class="bg-muted/40 size-6 rounded-full" />
        )}
        {secondary ? (
          <img
            src={secondary}
            alt={secondaryLabel ?? ""}
            class="bg-background/60 size-6 rounded-full p-0.5 ring-1 ring-border"
            loading="lazy"
          />
        ) : (
          <span class="bg-muted/40 size-6 rounded-full" />
        )}
      </div>
    </div>
  );
};

const StatsCluster: FC<{ row: TimelineRow }> = ({ row }) => (
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex items-baseline gap-2">
      <span class="font-mono text-foreground text-lg leading-none font-medium">
        {row.kills}<span class="text-muted-foreground"> / </span>
        <span class="text-destructive/90">{row.deaths}</span>
        <span class="text-muted-foreground"> / </span>{row.assists}
      </span>
      <span class="text-muted-foreground font-mono text-xs">{kdaRatio(row)} KDA</span>
    </div>
    <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <span class="font-mono">
        {csOf(row)} CS · <span class="text-muted-foreground/80">{csPerMin(row)}/m</span>
      </span>
      <span class="font-mono">
        {(row.goldEarned ?? 0).toLocaleString()} g · <span class="text-muted-foreground/80">{gpm(row)}/m</span>
      </span>
      {row.visionScore != null ? <span class="font-mono">{row.visionScore} vision</span> : null}
    </div>
  </div>
);

const ItemsStrip: FC<{ version: string; items: Array<number | null>; trinket: number | null }> = ({
  version,
  items,
  trinket,
}) => (
  <div class="flex shrink-0 items-center gap-1.5">
    <div class="grid grid-cols-6 gap-1">
      {items.map((id) => (
        <ItemCell version={version} id={id} />
      ))}
    </div>
    <div class="bg-border h-7 w-px" />
    <ItemCell version={version} id={trinket} />
  </div>
);

const ItemCell: FC<{ version: string; id: number | null }> = ({ version, id }) => {
  if (!id) return <span class="bg-muted/40 size-7 rounded ring-1 ring-border/40" />;
  return (
    <img
      src={itemIcon(version, id)}
      alt={`Item ${id}`}
      class="size-7 rounded ring-1 ring-border"
      loading="lazy"
    />
  );
};

const OutcomeCluster: FC<{ outcome: "win" | "loss" | "remake"; queue: string; when: string; duration: string }> = ({
  outcome,
  queue,
  when,
  duration,
}) => (
  <div class="flex shrink-0 flex-col items-end gap-0.5">
    <span
      class={cn(
        "text-base font-semibold tracking-tight",
        outcome === "win"
          ? "text-success"
          : outcome === "loss"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
    >
      {outcome === "win" ? "Victory" : outcome === "loss" ? "Defeat" : "Remake"}
    </span>
    <span class="text-muted-foreground text-xs">{queue}</span>
    <span class="text-muted-foreground/80 font-mono text-[11px]">
      {duration} · {when}
    </span>
  </div>
);
