import type { FC } from "hono/jsx";
import type { MatchRaw, RankInfo } from "../../db/queries.js";
import type { Match, MatchParticipant, MatchTimeline } from "../../riot/types.js";
import { QUEUE_NAMES } from "../../lib/queues.js";
import {
  championIcon,
  ddragonVersion,
  itemIcon,
  runeTreeIcon,
  summonerSpellIcon,
} from "../lib/ddragon.js";
import { cn } from "../lib/cn.js";
import {
  csOf,
  fmtClock,
  goldByMinute,
  kpPercent,
  participantScores,
  rankMatch,
  renderableEvents,
  summarizeTeam,
  teamParticipants,
  type MatchRanking,
  type ParticipantScore,
} from "../lib/match-helpers.js";
import { Badge } from "../components/ui.js";

const TIER_CODE: Record<string, string> = {
  IRON: "I",
  BRONZE: "B",
  SILVER: "S",
  GOLD: "G",
  PLATINUM: "P",
  EMERALD: "E",
  DIAMOND: "D",
  MASTER: "M",
  GRANDMASTER: "GM",
  CHALLENGER: "CH",
};
const DIV_NUM: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" };

const SCORE_LABELS: Array<[keyof ParticipantScore["breakdown"], string, string]> = [
  ["kda", "KDA", "Kills + assists per death (capped at 20 pts)"],
  ["damage", "Damage Dealt", "Damage to champions relative to match leader (25 pts)"],
  ["killParticipation", "Kill Participation", "Share of team kills + assists (25 pts)"],
  ["vision", "Vision", "Vision score relative to match leader (10 pts)"],
  ["towerDamage", "Tower Damage", "Damage to turrets relative to leader (7 pts)"],
  ["healing", "Healing", "Healing on teammates relative to leader (5 pts)"],
  ["shielding", "Shielding", "Shielding on teammates relative to leader (5 pts)"],
  ["tanking", "Tanking", "Damage taken relative to leader (5 pts)"],
  ["victory", "Victory", "Flat bonus for winning (5 pts)"],
];

function scoreTooltip(score: ParticipantScore | undefined): string | undefined {
  if (!score) return undefined;
  const lines = SCORE_LABELS.map(
    ([key, label]) => `${label.padEnd(18, " ")} ${score.breakdown[key].toFixed(1)}`,
  );
  lines.push("─".repeat(24));
  lines.push(`${"Total".padEnd(18, " ")} ${score.breakdown.total.toFixed(1)} / 100`);
  return lines.join("\n");
}

function placementLabel(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

const COOKED_THRESHOLD = 2; // bottom-N globally get the COOKED tag

function rankShort(r: RankInfo | undefined): string | undefined {
  if (!r || !r.tier) return undefined;
  const code = TIER_CODE[r.tier] ?? r.tier.slice(0, 1);
  const apex = code === "M" || code === "GM" || code === "CH";
  if (apex) return code;
  const div = r.rank ? DIV_NUM[r.rank] ?? r.rank : "";
  return `${code}${div}`;
}

export type TabKey = "overview" | "stats" | "timeline" | "gold";

const TABS: Array<{ key: TabKey; label: string; href: (id: string) => string }> = [
  { key: "overview", label: "Overview", href: (id) => `/fragments/match/${id}` },
  { key: "stats", label: "Stats", href: (id) => `/fragments/match/${id}/stats` },
  { key: "timeline", label: "Timeline", href: (id) => `/fragments/match/${id}/timeline` },
  { key: "gold", label: "Gold Graph", href: (id) => `/fragments/match/${id}/gold` },
];

export interface MatchTabsProps {
  raw: MatchRaw;
  active: TabKey;
}

export const MatchTabs: FC<MatchTabsProps> = ({ raw, active }) => {
  const containerId = `match-${raw.match.metadata.matchId}-detail`;
  return (
    <div id={containerId} class="flex flex-col gap-4">
      <TabStrip raw={raw} active={active} containerId={containerId} />
      <TabBody raw={raw} active={active} />
    </div>
  );
};

const TabStrip: FC<{ raw: MatchRaw; active: TabKey; containerId: string }> = ({
  raw,
  active,
  containerId,
}) => {
  const id = raw.match.metadata.matchId;
  const hasTimeline = raw.timeline != null;
  return (
    <nav class="border-b flex items-center gap-1 overflow-x-auto" role="tablist">
      {TABS.map((tab) => {
        const disabled = !hasTimeline && (tab.key === "timeline" || tab.key === "gold");
        const isActive = tab.key === active;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={isActive ? "true" : "false"}
            disabled={disabled}
            hx-get={disabled ? undefined : tab.href(id)}
            hx-target={`#${containerId}`}
            hx-swap="outerHTML"
            class={cn(
              "relative cursor-pointer whitespace-nowrap px-3 py-2 text-sm transition-colors",
              "after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:content-['']",
              isActive
                ? "text-foreground after:bg-foreground"
                : "text-muted-foreground hover:text-foreground after:bg-transparent",
              disabled && "cursor-not-allowed opacity-40",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};

const TabBody: FC<{ raw: MatchRaw; active: TabKey }> = ({ raw, active }) => {
  if (active === "overview") return <OverviewTab raw={raw} />;
  if (active === "stats") return <StatsTab raw={raw} />;
  if (active === "timeline") return <TimelineTab raw={raw} />;
  if (active === "gold") return <GoldGraphTab raw={raw} />;
  return null;
};

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

const OverviewTab: FC<{ raw: MatchRaw }> = ({ raw }) => {
  const { match, trackedNames, trackedRanks } = raw;
  const ver = ddragonVersion(match.info.gameVersion);
  const allDmg = match.info.participants.map((p) => p.totalDamageDealtToChampions ?? 0);
  const maxDmg = Math.max(1, ...allDmg);
  const scores = participantScores(match);
  const ranking = rankMatch(scores);
  return (
    <div class="flex flex-col gap-4">
      <MatchMetaLine match={match} />
      {[100, 200].map((teamId) => (
        <TeamPanel
          match={match}
          teamId={teamId}
          version={ver}
          maxDmg={maxDmg}
          trackedNames={trackedNames}
          trackedRanks={trackedRanks}
          scores={scores}
          ranking={ranking}
        />
      ))}
    </div>
  );
};

const MatchMetaLine: FC<{ match: Match }> = ({ match }) => (
  <div class="text-muted-foreground flex flex-wrap items-baseline gap-3 text-xs">
    <span class="text-foreground font-medium">
      {QUEUE_NAMES[match.info.queueId] ?? match.info.gameMode}
    </span>
    <span class="font-mono">{fmtClock(match.info.gameDuration * 1000)}</span>
    <span class="font-mono">{new Date(match.info.gameStartTimestamp).toLocaleString()}</span>
    <span class="font-mono">{match.info.gameVersion}</span>
  </div>
);

const TeamPanel: FC<{
  match: Match;
  teamId: number;
  version: string;
  maxDmg: number;
  trackedNames: Map<string, string>;
  trackedRanks: Map<string, RankInfo>;
  scores: Map<string, ParticipantScore>;
  ranking: MatchRanking;
}> = ({ match, teamId, version, maxDmg, trackedNames, trackedRanks, scores, ranking }) => {
  const summary = summarizeTeam(match, teamId);
  const members = teamParticipants(match, teamId);
  const accent = teamId === 100 ? "text-sky-400" : "text-rose-400";
  const total = ranking.ordered.length;
  const teamWorstPuuid = [...members]
    .map((m) => ({ puuid: m.puuid, total: scores.get(m.puuid)?.breakdown.total ?? 0 }))
    .sort((a, b) => a.total - b.total)[0]?.puuid;
  return (
    <div class="overflow-hidden rounded-lg border">
      <header class={cn("flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2", summary.win ? "bg-success/[0.06]" : "bg-destructive/[0.06]")}>
        <div class="flex items-center gap-3">
          <span class={cn("text-sm font-semibold", accent)}>
            {teamId === 100 ? "Blue Team" : "Red Team"}
          </span>
          {summary.win ? <Badge variant="success">Win</Badge> : <Badge variant="destructive">Loss</Badge>}
        </div>
        <dl class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
          <Stat label="K/D/A" value={`${summary.kills}/${summary.deaths}/${summary.assists}`} />
          <Stat label="Towers" value={summary.towers} />
          <Stat label="Drakes" value={summary.dragons} />
          <Stat label="Barons" value={summary.barons} />
          <Stat label="Inhibs" value={summary.inhibitors} />
          <Stat label="Gold" value={summary.gold.toLocaleString()} />
          <Stat label="Dmg" value={summary.damage.toLocaleString()} />
        </dl>
      </header>
      <div class="divide-y">
        {members.map((p) => {
          const place = ranking.placement.get(p.puuid) ?? 0;
          return (
            <ParticipantRow
              participant={p}
              teamMembers={members}
              version={version}
              maxDmg={maxDmg}
              highlighted={trackedNames.has(p.puuid)}
              displayName={trackedNames.get(p.puuid)}
              rank={trackedRanks.get(p.puuid)}
              score={scores.get(p.puuid)}
              placement={place}
              fieldSize={total}
              isTeamWorst={p.puuid === teamWorstPuuid && members.length > 1}
            />
          );
        })}
      </div>
    </div>
  );
};

const Stat: FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div class="flex items-baseline gap-1">
    <dt class="text-muted-foreground/70 text-[10px] uppercase tracking-wide">{label}</dt>
    <dd class="text-foreground">{value}</dd>
  </div>
);

const ParticipantRow: FC<{
  participant: MatchParticipant;
  teamMembers: MatchParticipant[];
  version: string;
  maxDmg: number;
  highlighted: boolean;
  displayName: string | undefined;
  rank: RankInfo | undefined;
  score: ParticipantScore | undefined;
  placement: number;
  fieldSize: number;
  isTeamWorst: boolean;
}> = ({ participant: p, teamMembers, version, maxDmg, highlighted, displayName, rank, score, placement, fieldSize, isTeamWorst }) => {
  const isMvp = placement === 1;
  const isAce = isTeamWorst;
  const scoreHover = scoreTooltip(score);
  const placeStyle = isMvp
    ? "bg-amber-400/20 text-amber-300"
    : placement >= fieldSize - 1 && fieldSize > 2
      ? "bg-rose-400/15 text-rose-300"
      : "bg-muted text-muted-foreground";
  const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5];
  const trinket = p.item6;
  const dmg = p.totalDamageDealtToChampions ?? 0;
  const dmgPct = Math.round((dmg / maxDmg) * 100);
  const kp = kpPercent(p, teamMembers);
  const cs = csOf(p);
  const cspm =
    p.gameStartTimestamp || true ? null : null; // placeholder; not needed here
  const name = displayName ?? p.riotIdGameName ?? p.summonerName ?? p.puuid.slice(0, 8);
  return (
    <div class={cn("grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-2 max-md:grid-cols-1", highlighted && (p.teamId === 100 ? "bg-sky-400/15" : "bg-rose-400/15"))}>
      <div class="flex items-center gap-2">
        <div class="relative shrink-0">
          <img src={championIcon(version, p.championName)} alt="" class="size-9 rounded-md ring-1 ring-border" loading="lazy" />
          <span class="font-mono absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-card text-[9px] ring-1 ring-border">
            {p.champLevel}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <SpellPair version={version} a={p.summoner1Id} b={p.summoner2Id} />
        </div>
        <RunePair version={version} primary={p.perks?.styles[0]?.style} secondary={p.perks?.styles[1]?.style} />
      </div>

      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <span class={cn("truncate text-sm", highlighted ? "text-foreground font-medium" : "text-muted-foreground")}>
            {name}
          </span>
          {rankShort(rank) && (
            <span
              class="font-mono rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80"
              title={rank?.leaguePoints != null ? `${rank.tier} ${rank.rank ?? ""} ${rank.leaguePoints} LP` : undefined}
            >
              {rankShort(rank)}
            </span>
          )}
          {isMvp && (
            <span
              class="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
              title="Highest performance score on this team"
            >
              MVP
            </span>
          )}
          {isAce && (
            <span
              class="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300"
              title="Lowest performance score on this team"
            >
              COOKED
            </span>
          )}
        </div>
        <div class="text-muted-foreground text-xs flex items-center gap-2">
          <span>{p.championName}</span>
          {score && (
            <span
              class={cn("font-mono rounded px-1.5 py-0.5 text-[10px] font-medium", placeStyle)}
              title={scoreHover}
            >
              {placementLabel(placement)} · {score.breakdown.total.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div class="flex items-center gap-1">
        {items.map((id) => (
          <ItemSlot version={version} id={id} />
        ))}
        <div class="bg-border mx-1 h-6 w-px" />
        <ItemSlot version={version} id={trinket ?? null} />
      </div>

      <div class="font-mono text-right text-xs">
        <div class="text-foreground">
          {p.kills}<span class="text-muted-foreground"> / </span>
          <span class="text-destructive/90">{p.deaths}</span>
          <span class="text-muted-foreground"> / </span>{p.assists}
        </div>
        <div class="text-muted-foreground">
          {cs} CS · {kp}% KP
        </div>
      </div>

      <div class="flex w-32 flex-col items-end gap-1">
        <span class="text-foreground font-mono text-xs">{dmg.toLocaleString()}</span>
        <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            class={cn("h-full", p.win ? "bg-success/80" : "bg-destructive/80")}
            style={`width: ${dmgPct}%`}
          />
        </div>
      </div>
    </div>
  );
};

const SpellPair: FC<{ version: string; a: number | undefined; b: number | undefined }> = ({
  version,
  a,
  b,
}) => (
  <div class="flex gap-1">
    <SpellIcon version={version} id={a} />
    <SpellIcon version={version} id={b} />
  </div>
);

const SpellIcon: FC<{ version: string; id: number | undefined }> = ({ version, id }) => {
  const url = summonerSpellIcon(version, id);
  if (!url) return <span class="bg-muted/40 size-4 rounded" />;
  return <img src={url} alt="" class="size-4 rounded ring-1 ring-border" loading="lazy" />;
};

const RunePair: FC<{ version: string; primary: number | undefined; secondary: number | undefined }> = ({
  primary,
  secondary,
}) => (
  <div class="flex flex-col gap-1">
    <RuneIcon id={primary} />
    <RuneIcon id={secondary} />
  </div>
);

const RuneIcon: FC<{ id: number | undefined }> = ({ id }) => {
  const url = runeTreeIcon(id);
  if (!url) return <span class="bg-muted/40 size-4 rounded-full" />;
  return <img src={url} alt="" class="size-4 rounded-full p-0.5 ring-1 ring-border" loading="lazy" />;
};

const ItemSlot: FC<{ version: string; id: number | null | undefined }> = ({ version, id }) => {
  if (!id) return <span class="bg-muted/30 size-6 rounded ring-1 ring-border/30" />;
  return (
    <img
      src={itemIcon(version, id)}
      alt={`Item ${id}`}
      class="size-6 rounded ring-1 ring-border"
      loading="lazy"
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

interface StatRow {
  label: string;
  pick: (p: MatchParticipant) => number | null | undefined;
  format?: (n: number) => string;
  bold?: "max";
  tooltip?: string;
}

interface StatSection {
  title: string;
  rows: StatRow[];
}

const kFmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const intFmt = (n: number) => Math.round(n).toLocaleString();

const oneDp = (n: number) => n.toFixed(1);

const blankScore = (p: MatchParticipant): ParticipantScore => ({
  puuid: p.puuid,
  teamId: p.teamId,
  breakdown: {
    kda: 0,
    damage: 0,
    killParticipation: 0,
    vision: 0,
    towerDamage: 0,
    healing: 0,
    shielding: 0,
    tanking: 0,
    victory: 0,
    total: 0,
  },
});

const STAT_SECTIONS: StatSection[] = [
  {
    title: "Combat",
    rows: [
      { label: "KDA", pick: () => null, format: intFmt, tooltip: "Kills / Deaths / Assists" },
      { label: "Largest Killing Spree", pick: (p) => p.largestKillingSpree ?? 0, bold: "max", tooltip: "Most consecutive kills without dying" },
      { label: "Largest Multi Kill", pick: (p) => p.largestMultiKill ?? 0, bold: "max", tooltip: "Most kills in a single multikill (double = 2, penta = 5)" },
      { label: "Crowd Control Score", pick: (p) => p.timeCCingOthers ?? 0, bold: "max", tooltip: "Seconds of crowd-control applied to enemy champions" },
    ],
  },
  {
    title: "Damage Dealt",
    rows: [
      { label: "Total Dmg To Champions", pick: (p) => p.totalDamageDealtToChampions ?? 0, format: kFmt, bold: "max", tooltip: "Pre-mitigation damage dealt to enemy champions" },
      { label: "Physical Dmg To Champions", pick: (p) => p.physicalDamageDealtToChampions ?? 0, format: kFmt, bold: "max", tooltip: "Physical (AD) damage to champions" },
      { label: "Magic Dmg To Champions", pick: (p) => p.magicDamageDealtToChampions ?? 0, format: kFmt, bold: "max", tooltip: "Magic (AP) damage to champions" },
      { label: "True Dmg To Champions", pick: (p) => p.trueDamageDealtToChampions ?? 0, format: kFmt, bold: "max", tooltip: "True damage to champions (ignores resistances)" },
      { label: "Total Dmg", pick: (p) => p.totalDamageDealt ?? 0, format: kFmt, bold: "max", tooltip: "All damage dealt — to champs, minions, monsters, structures" },
      { label: "Physical Dmg", pick: (p) => p.physicalDamageDealt ?? 0, format: kFmt, bold: "max", tooltip: "All physical damage dealt" },
      { label: "Magic Dmg", pick: (p) => p.magicDamageDealt ?? 0, format: kFmt, bold: "max", tooltip: "All magic damage dealt" },
      { label: "True Dmg", pick: (p) => p.trueDamageDealt ?? 0, format: kFmt, bold: "max", tooltip: "All true damage dealt" },
      { label: "Largest Critical Strike", pick: (p) => p.largestCriticalStrike ?? 0, format: kFmt, bold: "max", tooltip: "Biggest single critical hit dealt" },
      { label: "Total Dmg To Objectives", pick: (p) => p.damageDealtToObjectives ?? 0, format: kFmt, bold: "max", tooltip: "Damage to dragons, baron, herald, turrets, inhibitors" },
      { label: "Total Dmg to Turrets", pick: (p) => p.damageDealtToTurrets ?? 0, format: kFmt, bold: "max", tooltip: "Damage to enemy turrets" },
    ],
  },
  {
    title: "Damage Taken and Healed",
    rows: [
      { label: "Dmg Healed", pick: (p) => p.totalHeal ?? 0, format: kFmt, bold: "max", tooltip: "All healing done — self and allies" },
      { label: "Ally Healing", pick: (p) => p.totalHealsOnTeammates ?? 0, format: kFmt, bold: "max", tooltip: "Healing done only to teammates" },
      { label: "Ally Shielding", pick: (p) => p.totalDamageShieldedOnTeammates ?? 0, format: kFmt, bold: "max", tooltip: "Damage absorbed by shields placed on teammates" },
      { label: "Dmg Taken", pick: (p) => p.totalDamageTaken ?? 0, format: kFmt, bold: "max", tooltip: "Post-mitigation damage taken from all sources" },
      { label: "Physical Dmg Taken", pick: (p) => p.physicalDamageTaken ?? 0, format: kFmt, bold: "max", tooltip: "Physical damage taken (post-armor)" },
      { label: "Magic Dmg Taken", pick: (p) => p.magicDamageTaken ?? 0, format: kFmt, bold: "max", tooltip: "Magic damage taken (post-MR)" },
      { label: "True Dmg Taken", pick: (p) => p.trueDamageTaken ?? 0, format: kFmt, bold: "max", tooltip: "True damage taken (ignores resistances)" },
      { label: "Self Mitigated Dmg", pick: (p) => p.damageSelfMitigated ?? 0, format: kFmt, bold: "max", tooltip: "Damage prevented by armor, MR, shields, etc." },
      { label: "Time Spent Dead", pick: (p) => p.totalTimeSpentDead ?? 0, format: (n) => `${Math.round(n)}s`, bold: "max", tooltip: "Total seconds spent dead waiting to respawn" },
    ],
  },
  {
    title: "Vision",
    rows: [
      { label: "Vision Score", pick: (p) => p.visionScore ?? 0, bold: "max", tooltip: "Riot's combined ward placement / kill / pink score" },
      { label: "Wards Placed", pick: (p) => p.wardsPlaced ?? 0, bold: "max", tooltip: "Total wards placed (yellow + control + trinkets)" },
      { label: "Wards Destroyed", pick: (p) => p.wardsKilled ?? 0, bold: "max", tooltip: "Enemy wards cleared" },
      { label: "Control Wards Purchased", pick: (p) => p.visionWardsBoughtInGame ?? 0, bold: "max", tooltip: "Pink (control) wards bought from the shop" },
    ],
  },
  {
    title: "Income",
    rows: [
      { label: "Gold Earned", pick: (p) => p.goldEarned ?? 0, format: kFmt, bold: "max", tooltip: "Total gold earned over the game" },
      { label: "Gold Spent", pick: (p) => p.goldSpent ?? 0, format: kFmt, bold: "max", tooltip: "Gold spent on items" },
      { label: "Minions Killed", pick: (p) => p.totalMinionsKilled ?? 0, bold: "max", tooltip: "Lane minion CS" },
      { label: "Neutral Minions Killed", pick: (p) => p.neutralMinionsKilled ?? 0, bold: "max", tooltip: "Jungle camps killed (includes scuttles/voidgrubs)" },
    ],
  },
  {
    title: "Objectives",
    rows: [
      { label: "Towers Destroyed", pick: (p) => p.turretKills ?? 0, bold: "max", tooltip: "Turret kills credited to this player" },
      { label: "Inhibitors Destroyed", pick: (p) => p.inhibitorKills ?? 0, bold: "max", tooltip: "Inhibitor kills credited to this player" },
    ],
  },
];

const trackedBg = (p: MatchParticipant): string =>
  p.teamId === 100 ? "bg-sky-400/15" : "bg-rose-400/15";

const StatsTab: FC<{ raw: MatchRaw }> = ({ raw }) => {
  const { match, trackedNames, trackedRanks } = raw;
  const ver = ddragonVersion(match.info.gameVersion);
  const participants = match.info.participants;
  const scores = participantScores(match);

  const ranking = rankMatch(scores);
  const teamWorstPuuid = new Map<number, string | undefined>();
  for (const teamId of [100, 200]) {
    const worst = participants
      .filter((p) => p.teamId === teamId)
      .map((p) => ({ puuid: p.puuid, total: scores.get(p.puuid)?.breakdown.total ?? 0 }))
      .sort((a, b) => a.total - b.total)[0]?.puuid;
    teamWorstPuuid.set(teamId, worst);
  }

  return (
    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b">
            <th class="w-44 px-3 py-2 text-left text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              Stat
            </th>
            {participants.map((p) => {
              const place = ranking.placement.get(p.puuid) ?? 0;
              const isMvp = place === 1;
              const isAce = teamWorstPuuid.get(p.teamId) === p.puuid;
              const rs = rankShort(trackedRanks.get(p.puuid));
              const rankInfo = trackedRanks.get(p.puuid);
              const score = scores.get(p.puuid);
              return (
                <th
                  class={cn(
                    "px-2 py-2",
                    trackedNames.has(p.puuid) && trackedBg(p),
                  )}
                  title={`${p.championName}${score ? ` · score ${score.breakdown.total.toFixed(1)}` : ""}`}
                >
                  <div class="flex flex-col items-center gap-1">
                    <img
                      src={championIcon(ver, p.championName)}
                      alt={p.championName}
                      class="size-7 rounded ring-1 ring-border"
                      loading="lazy"
                    />
                    <div class="flex items-center gap-1">
                      {rs && (
                        <span
                          class="font-mono rounded bg-muted px-1 py-px text-[9px] text-foreground/80"
                          title={
                            rankInfo
                              ? `${rankInfo.tier} ${rankInfo.rank ?? ""} ${rankInfo.leaguePoints ?? 0} LP (Solo Queue)`
                              : undefined
                          }
                        >
                          {rs}
                        </span>
                      )}
                      {isMvp && (
                        <span
                          class="rounded bg-amber-400/20 px-1 py-px text-[9px] font-semibold uppercase text-amber-300"
                          title="Highest performance score on this team"
                        >
                          MVP
                        </span>
                      )}
                      {isAce && (
                        <span
                          class="rounded bg-rose-500/20 px-1 py-px text-[9px] font-semibold uppercase text-rose-300"
                          title="Lowest performance score on this team"
                        >
                          COOKED
                        </span>
                      )}
                    </div>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <>
            <tr>
              <td
                colspan={participants.length + 1}
                class="bg-muted/30 text-foreground/90 px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase"
              >
                Performance Score
              </td>
            </tr>
            {(
              [
                ...SCORE_LABELS.map(
                  ([key, label, desc]) =>
                    [label, (s: ParticipantScore) => s.breakdown[key], desc] as [
                      string,
                      (s: ParticipantScore) => number,
                      string,
                    ],
                ),
                ["Total", (s: ParticipantScore) => s.breakdown.total, "Sum of all components (max 100)"] as [
                  string,
                  (s: ParticipantScore) => number,
                  string,
                ],
              ]
            ).map(([label, pick, desc]) => {
              const nums = participants.map((p) => pick(scores.get(p.puuid) ?? blankScore(p)));
              const formatted = nums.map(oneDp);
              const boldIndices = label === "Total" ? indicesOfMax(nums) : new Set<number>();
              return (
                <StatLine
                  label={label}
                  participants={participants}
                  values={formatted}
                  boldIndices={boldIndices}
                  trackedNames={trackedNames}
                  tooltip={desc}
                />
              );
            })}
          </>
          {STAT_SECTIONS.map((section) => (
            <>
              <tr>
                <td
                  colspan={participants.length + 1}
                  class="bg-muted/30 text-foreground/90 px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase"
                >
                  {section.title}
                </td>
              </tr>
              {section.rows.map((row) => {
                if (row.label === "KDA") {
                  return (
                    <StatLine
                      label="KDA"
                      participants={participants}
                      values={participants.map((p) => `${p.kills}/${p.deaths}/${p.assists}`)}
                      boldIndices={new Set()}
                      trackedNames={trackedNames}
                      tooltip={row.tooltip}
                    />
                  );
                }
                const nums = participants.map((p) => Number(row.pick(p) ?? 0));
                const formatted = nums.map((n) => (row.format ?? intFmt)(n));
                const boldIndices = row.bold === "max" ? indicesOfMax(nums) : new Set<number>();
                return (
                  <StatLine
                    label={row.label}
                    participants={participants}
                    values={formatted}
                    boldIndices={boldIndices}
                    trackedNames={trackedNames}
                    tooltip={row.tooltip}
                  />
                );
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function indicesOfMax(arr: number[]): Set<number> {
  const result = new Set<number>();
  let max = -Infinity;
  arr.forEach((n) => {
    if (n > max) max = n;
  });
  if (max <= 0) return result;
  arr.forEach((n, i) => {
    if (n === max) result.add(i);
  });
  return result;
}

const StatLine: FC<{
  label: string;
  participants: MatchParticipant[];
  values: string[];
  boldIndices: Set<number>;
  trackedNames: Map<string, string>;
  tooltip?: string | undefined;
}> = ({ label, participants, values, boldIndices, trackedNames, tooltip }) => (
  <tr class="border-b last:border-0">
    <td class="text-muted-foreground px-3 py-1.5" title={tooltip}>
      <span class={cn(tooltip && "decoration-dotted underline underline-offset-2")}>
        {label}
      </span>
    </td>
    {participants.map((p, i) => (
      <td
        class={cn(
          "px-2 py-1.5 text-center font-mono",
          trackedNames.has(p.puuid) && trackedBg(p),
          boldIndices.has(i) ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {values[i]}
      </td>
    ))}
  </tr>
);

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

const TimelineTab: FC<{ raw: MatchRaw }> = ({ raw }) => {
  const tl = raw.timeline;
  if (!tl) return <EmptyTab message="No timeline data for this match." />;
  const ver = ddragonVersion(raw.match.info.gameVersion);
  const events = renderableEvents(raw.match, tl);
  if (events.length === 0) return <EmptyTab message="No noteworthy events." />;
  return (
    <ol class="flex flex-col">
      {events.map((ev) => {
        const teamColor = ev.actorTeamId === 100 ? "bg-sky-400" : ev.actorTeamId === 200 ? "bg-rose-400" : "bg-muted-foreground";
        return (
          <li class="relative flex items-start gap-3 border-l py-2 pl-5">
            <span class={cn("absolute left-0 top-3 size-2 -translate-x-1/2 rounded-full", teamColor)} />
            <span class="text-muted-foreground font-mono w-12 shrink-0 pt-px text-xs tabular-nums">
              {fmtClock(ev.timestamp)}
            </span>
            {ev.actorChampion ? (
              <img
                src={championIcon(ver, ev.actorChampion)}
                alt=""
                class="size-6 rounded ring-1 ring-border"
                loading="lazy"
              />
            ) : (
              <span class="size-6" />
            )}
            <span class="text-foreground pt-0.5 text-sm">{ev.text}</span>
          </li>
        );
      })}
    </ol>
  );
};

/* -------------------------------------------------------------------------- */
/* Gold Graph                                                                 */
/* -------------------------------------------------------------------------- */

const GoldGraphTab: FC<{ raw: MatchRaw }> = ({ raw }) => {
  const tl = raw.timeline;
  if (!tl) return <EmptyTab message="No timeline data for this match." />;
  const rawFrames = goldByMinute(raw.match, tl);
  if (rawFrames.length === 0) return <EmptyTab message="No gold data." />;

  const friendsTeam =
    raw.match.info.participants.find((p) => raw.trackedNames.has(p.puuid))?.teamId ?? 100;
  const friendsBlue = friendsTeam === 100;
  const frames = rawFrames.map((f) => ({
    minute: f.minute,
    delta: friendsBlue ? f.delta : -f.delta,
  }));

  const friendColor = friendsBlue ? "rgb(96 165 250)" : "rgb(251 113 133)";
  const enemyColor = friendsBlue ? "rgb(251 113 133)" : "rgb(96 165 250)";
  const friendTone = friendsBlue ? "text-sky-400" : "text-rose-400";
  const enemyTone = friendsBlue ? "text-rose-400" : "text-sky-400";

  const maxAbs = Math.max(1, ...frames.map((f) => Math.abs(f.delta)));
  const width = Math.max(400, frames.length * 18);
  const height = 220;
  const padding = 24;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const barW = Math.max(4, innerW / frames.length - 2);
  const mid = padding + innerH / 2;

  const finalDelta = frames[frames.length - 1]?.delta ?? 0;
  const highPeak = frames.reduce(
    (acc, f) => (f.delta > acc.delta ? f : acc),
    { minute: 0, delta: 0 },
  );
  const lowPeak = frames.reduce(
    (acc, f) => (f.delta < acc.delta ? f : acc),
    { minute: 0, delta: 0 },
  );
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toLocaleString()}`;

  return (
    <div class="flex flex-col gap-3">
      <div class="text-muted-foreground flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <span>
          Final gold delta:{" "}
          <span class={cn("font-mono", finalDelta >= 0 ? friendTone : enemyTone)}>
            {signed(finalDelta)}
          </span>{" "}
          <span class="text-muted-foreground/70">(friends − enemy)</span>
        </span>
        <span>
          Friend peak:{" "}
          <span class={cn("font-mono", friendTone)}>{signed(highPeak.delta)}</span>{" "}
          <span class="text-muted-foreground/70">@ {highPeak.minute}:00</span>
        </span>
        <span>
          Enemy peak:{" "}
          <span class={cn("font-mono", enemyTone)}>{signed(lowPeak.delta)}</span>{" "}
          <span class="text-muted-foreground/70">@ {lowPeak.minute}:00</span>
        </span>
      </div>
      <div class="overflow-x-auto rounded-lg border p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          class="block"
          role="img"
          aria-label="Gold differential over time (friends perspective)"
        >
          <line
            x1={padding}
            x2={width - padding}
            y1={mid}
            y2={mid}
            stroke="currentColor"
            stroke-opacity="0.25"
            stroke-dasharray="2 4"
          />
          {frames.map((f, i) => {
            const h = (Math.abs(f.delta) / maxAbs) * (innerH / 2);
            const x = padding + i * (barW + 2);
            const y = f.delta >= 0 ? mid - h : mid;
            const fill = f.delta >= 0 ? friendColor : enemyColor;
            return <rect x={x} y={y} width={barW} height={h} rx={1} fill={fill} fill-opacity="0.85" />;
          })}
          {highPeak.delta > 0 && (
            <text
              x={padding + highPeak.minute * (barW + 2) + barW / 2}
              y={Math.max(padding - 2, mid - (highPeak.delta / maxAbs) * (innerH / 2) - 4)}
              text-anchor="middle"
              class="font-mono"
              font-size="10"
              fill={friendColor}
            >
              {signed(highPeak.delta)}
            </text>
          )}
          {lowPeak.delta < 0 && (
            <text
              x={padding + lowPeak.minute * (barW + 2) + barW / 2}
              y={Math.min(height - padding + 10, mid + (Math.abs(lowPeak.delta) / maxAbs) * (innerH / 2) + 10)}
              text-anchor="middle"
              class="font-mono"
              font-size="10"
              fill={enemyColor}
            >
              {signed(lowPeak.delta)}
            </text>
          )}
          <text
            x={padding}
            y={padding - 6}
            class="font-mono"
            font-size="10"
            fill="currentColor"
            fill-opacity="0.55"
          >
            Friends ahead
          </text>
          <text
            x={padding}
            y={height - 8}
            class="font-mono"
            font-size="10"
            fill="currentColor"
            fill-opacity="0.55"
          >
            Enemy ahead
          </text>
          <text
            x={width - padding}
            y={height - 8}
            text-anchor="end"
            class="font-mono"
            font-size="10"
            fill="currentColor"
            fill-opacity="0.55"
          >
            {frames.length - 1}:00
          </text>
        </svg>
      </div>
    </div>
  );
};

const EmptyTab: FC<{ message: string }> = ({ message }) => (
  <div class="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
    {message}
  </div>
);
