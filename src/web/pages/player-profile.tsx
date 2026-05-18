import type { FC } from "hono/jsx";
import type {
  ChampionStat,
  MasteryStat,
  ProfileData,
  ProfileRecentMatch,
  RankSnapshotPoint,
  RoleStat,
} from "../../db/profile-queries.js";
import type { TimelineRow } from "../../db/queries.js";
import { QUEUE_GROUPS } from "../../lib/queues.js";
import { MatchRow } from "../components/match-row.js";
import { championIcon, ddragonVersion } from "../lib/ddragon.js";
import { cn } from "../lib/cn.js";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Label,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "../components/ui.js";

export interface PlayerProfileFilters {
  since: string;
  queue: string;
}

export interface PlayerProfileProps {
  data: ProfileData;
  filters: PlayerProfileFilters;
}

const SINCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "Last 30d" },
  { value: "all", label: "All time" },
];

const QUEUE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All queues" },
  ...Object.keys(QUEUE_GROUPS).map((key) => ({ value: key, label: key })),
];

const POSITION_LABEL: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "ADC",
  UTILITY: "Support",
};

const POSITION_ORDER: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  BOTTOM: 3,
  UTILITY: 4,
};

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

function fmtRank(
  tier: string | null | undefined,
  division: string | null | undefined,
  lp: number | null | undefined,
): string | undefined {
  if (!tier) return undefined;
  const apex = tier === "MASTER" || tier === "GRANDMASTER" || tier === "CHALLENGER";
  const tierName = tier[0] + tier.slice(1).toLowerCase();
  if (apex) return `${tierName} · ${lp ?? 0} LP`;
  return `${tierName} ${division ?? ""} · ${lp ?? 0} LP`;
}

function rankShort(tier: string, division: string | null): string {
  const code = TIER_CODE[tier] ?? tier.slice(0, 1);
  const apex = code === "M" || code === "GM" || code === "CH";
  if (apex) return code;
  const divNum: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" };
  const d = division ? divNum[division] ?? division : "";
  return `${code}${d}`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Convert a `ProfileRecentMatch` (per-player projection) into the broader
 * `TimelineRow` shape that the shared `MatchRow` component consumes.
 */
function toTimelineRow(player: ProfileData["player"], r: ProfileRecentMatch): TimelineRow {
  return {
    matchId: r.matchId,
    gameStart: r.gameStart,
    gameDuration: r.gameDuration,
    gameVersion: r.gameVersion,
    queueId: r.queueId,
    gameMode: r.gameMode,
    puuid: player.puuid,
    displayName: player.displayName,
    gameName: player.gameName,
    championName: r.championName,
    champLevel: r.champLevel,
    teamPosition: r.teamPosition,
    teamId: r.teamId,
    win: r.win,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    totalMinionsKilled: r.totalMinionsKilled,
    neutralMinionsKilled: r.neutralMinionsKilled,
    goldEarned: r.goldEarned,
    visionScore: r.visionScore,
    summoner1Id: r.summoner1Id,
    summoner2Id: r.summoner2Id,
    perksPrimaryStyle: r.perksPrimaryStyle,
    perksSubStyle: r.perksSubStyle,
    perksKeystone: r.perksKeystone,
    item0: r.item0,
    item1: r.item1,
    item2: r.item2,
    item3: r.item3,
    item4: r.item4,
    item5: r.item5,
    item6: r.item6,
    doubleKills: r.doubleKills,
    tripleKills: r.tripleKills,
    quadraKills: r.quadraKills,
    pentaKills: r.pentaKills,
    firstBloodKill: r.firstBloodKill,
    gameEndedInSurrender: r.gameEndedInSurrender,
    teamEarlySurrendered: r.teamEarlySurrendered,
  };
}

const Header: FC<{ data: ProfileData }> = ({ data }) => {
  const { player, currentSoloRank } = data;
  const name = player.displayName ?? player.gameName;
  const rankLabel = currentSoloRank
    ? fmtRank(currentSoloRank.tier, currentSoloRank.division, currentSoloRank.leaguePoints)
    : undefined;
  return (
    <header class="flex flex-col gap-2">
      <div class="flex flex-wrap items-baseline gap-3">
        <h1 class="font-display text-2xl font-semibold tracking-tight text-foreground">{name}</h1>
        <span class="font-mono text-muted-foreground text-sm">
          {player.gameName}#{player.tagLine}
        </span>
        <Badge variant="outline" class="uppercase">
          {player.platform}
        </Badge>
        {rankLabel ? <Badge variant="secondary">Solo · {rankLabel}</Badge> : null}
      </div>
    </header>
  );
};

const HeadlineStats: FC<{ data: ProfileData }> = ({ data }) => {
  const h = data.headline;
  if (h.games === 0) {
    return (
      <Empty
        title="No matches in this window"
        description="Try widening the time range or changing the queue filter."
      />
    );
  }
  const items: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Games", value: String(h.games), hint: `${h.wins}W ${h.losses}L` },
    { label: "Winrate", value: pct(h.winrate) },
    { label: "Avg KDA", value: h.avgKda.toFixed(2) },
    { label: "CS / min", value: h.csPerMin.toFixed(1) },
    { label: "Gold / min", value: Math.round(h.goldPerMin).toLocaleString() },
    { label: "Vision / game", value: h.visionPerGame.toFixed(1) },
    { label: "Dmg / min", value: Math.round(h.dmgToChampsPerMin).toLocaleString() },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <dl class="grid grid-cols-2 gap-4 md:grid-cols-7">
          {items.map((it) => (
            <div class="flex flex-col gap-1">
              <dt class="text-muted-foreground text-[10px] uppercase tracking-wider">{it.label}</dt>
              <dd class="font-mono text-foreground text-lg leading-none">{it.value}</dd>
              {it.hint ? (
                <span class="text-muted-foreground/80 font-mono text-[10px]">{it.hint}</span>
              ) : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
};

const Sparkline: FC<{ points: RankSnapshotPoint[]; title: string }> = ({ points, title }) => {
  if (points.length < 2) return null;
  const maxX = points.length - 1;
  const scalars = points.map((p) => p.scalar);
  const minY = Math.min(...scalars);
  const maxY = Math.max(...scalars);
  const yRange = maxY - minY || 1;
  const width = 600;
  const height = 60;
  const padX = 4;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const project = (i: number, y: number): [number, number] => {
    const px = padX + (i / (maxX || 1)) * innerW;
    const py = padY + innerH - ((y - minY) / yRange) * innerH;
    return [px, py];
  };
  const path = points
    .map((p, i) => {
      const [x, y] = project(i, p.scalar);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const trend = last && first ? last.scalar - first.scalar : 0;
  const trendTone =
    trend > 0 ? "text-success" : trend < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between">
        <span class="text-foreground text-sm font-medium">{title}</span>
        <span class={cn("font-mono text-xs", trendTone)}>
          {trend > 0 ? "+" : ""}
          {trend} LP·tier
        </span>
      </div>
      <div class="overflow-hidden rounded-lg border bg-muted/20 p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          class="block"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title} rank history`}
        >
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="text-foreground"
          />
          {points.map((p, i) => {
            const [x, y] = project(i, p.scalar);
            const label = `${p.tier}${p.division ? " " + p.division : ""} ${p.leaguePoints} LP · ${isoDate(p.capturedAt)}`;
            return (
              <circle cx={x} cy={y} r={2} class="fill-foreground/80">
                <title>{label}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      {last ? (
        <span class="text-muted-foreground font-mono text-[11px]">
          Latest: {rankShort(last.tier, last.division)} · {last.leaguePoints} LP
        </span>
      ) : null}
    </div>
  );
};

const RankHistoryCard: FC<{ data: ProfileData }> = ({ data }) => {
  const solo = data.rankHistorySolo;
  const flex = data.rankHistoryFlex;
  const hasSolo = solo.length >= 2;
  const hasFlex = flex.length >= 2;
  if (!hasSolo && !hasFlex) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>LP over time</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex flex-col gap-5">
          {hasSolo ? <Sparkline points={solo} title="Ranked Solo/Duo" /> : null}
          {hasFlex ? <Sparkline points={flex} title="Ranked Flex" /> : null}
        </div>
      </CardContent>
    </Card>
  );
};

const RoleDistribution: FC<{ roles: RoleStat[] }> = ({ roles }) => {
  const visible = roles
    .filter((r) => r.games > 0 && POSITION_LABEL[r.position])
    .sort((a, b) => (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99));
  if (visible.length === 0) return null;
  const maxGames = Math.max(...visible.map((r) => r.games));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ul class="flex flex-col gap-2.5">
          {visible.map((r) => {
            const pctOfMax = Math.max(2, Math.round((r.games / maxGames) * 100));
            return (
              <li class="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3">
                <span class="text-foreground text-sm">{POSITION_LABEL[r.position]}</span>
                <div class="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    class={cn(
                      "h-full rounded-full",
                      r.winrate >= 0.5 ? "bg-success/70" : "bg-destructive/70",
                    )}
                    style={`width: ${pctOfMax}%`}
                  />
                </div>
                <span class="font-mono text-muted-foreground text-xs">
                  {r.games}g · {pct(r.winrate)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};

const ChampionStatsCard: FC<{ champs: ChampionStat[]; version: string }> = ({
  champs,
  version,
}) => {
  if (champs.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top champions</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>Champion</TH>
              <TH class="text-right">Games</TH>
              <TH class="text-right">Winrate</TH>
              <TH class="text-right">Avg KDA</TH>
            </TR>
          </THead>
          <TBody>
            {champs.map((c) => (
              <TR>
                <TD>
                  <div class="flex items-center gap-2.5">
                    <img
                      src={championIcon(version, c.championName)}
                      alt={c.championName}
                      class="size-8 rounded ring-1 ring-border"
                      loading="lazy"
                    />
                    <span class="text-foreground text-sm font-medium">{c.championName}</span>
                  </div>
                </TD>
                <TD class="text-right font-mono tabular-nums">{c.games}</TD>
                <TD
                  class={cn(
                    "text-right font-mono tabular-nums",
                    c.winrate >= 0.5 ? "text-success" : "text-destructive",
                  )}
                >
                  {pct(c.winrate)}
                </TD>
                <TD class="text-right font-mono tabular-nums text-muted-foreground">
                  {c.avgKda.toFixed(2)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
};

const MasteryCard: FC<{ masteries: MasteryStat[]; champNameById: Map<number, string> }> = ({
  masteries,
  champNameById,
}) => {
  if (masteries.length === 0) return null;
  const version = ddragonVersion("14.24.1");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Champion mastery</CardTitle>
      </CardHeader>
      <CardContent>
        <ul class="grid grid-cols-2 gap-3 md:grid-cols-5">
          {masteries.map((m) => {
            const name = champNameById.get(m.championId) ?? `Champion ${m.championId}`;
            return (
              <li class="flex flex-col items-center gap-1.5 rounded-lg border bg-muted/20 p-3">
                <img
                  src={championIcon(version, name)}
                  alt={name}
                  class="size-12 rounded-lg ring-1 ring-border"
                  loading="lazy"
                />
                <span class="text-foreground truncate max-w-full text-xs font-medium">{name}</span>
                <div class="flex items-center gap-1.5">
                  <Badge variant="secondary">M{m.championLevel}</Badge>
                  <span class="font-mono text-muted-foreground text-[10px]">
                    {(m.championPoints / 1000).toFixed(0)}k
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};

const RecentMatchesCard: FC<{
  matches: ProfileRecentMatch[];
  player: ProfileData["player"];
}> = ({ matches, player }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent matches</CardTitle>
      </CardHeader>
      <CardContent>
        {matches.length === 0 ? (
          <Empty title="No matches" description="Nothing in this window for this player." />
        ) : (
          <div class="flex flex-col gap-3">
            {matches.map((m) => (
              <MatchRow row={toTimelineRow(player, m)} showPlayer={false} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * The swappable body — everything the htmx fragment endpoint will return.
 * Does NOT include the filter form or outer page header.
 */
export const PlayerProfileBody: FC<{ data: ProfileData }> = ({ data }) => {
  const version = ddragonVersion(data.latestGameVersion);
  const champNameById = new Map<number, string>(
    data.championStats.map((c) => [c.championId, c.championName]),
  );
  return (
    <div class="flex flex-col gap-6">
      <HeadlineStats data={data} />
      <RankHistoryCard data={data} />
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RoleDistribution roles={data.roleStats} />
        <ChampionStatsCard champs={data.championStats} version={version} />
      </div>
      <MasteryCard masteries={data.masteryTop} champNameById={champNameById} />
      <RecentMatchesCard matches={data.recentMatches} player={data.player} />
    </div>
  );
};

/**
 * Full profile page: filter form + outer container + the swappable body.
 */
export const PlayerProfilePage: FC<PlayerProfileProps> = ({ data, filters }) => {
  const { player } = data;
  const bodyId = `profile-body-${player.puuid}`;
  const spinnerId = `profile-spinner-${player.puuid}`;
  return (
    <div class="flex flex-col gap-6">
      <Header data={data} />

      <Card>
        <CardContent>
          <form
            class="grid grid-cols-1 gap-4 md:grid-cols-2"
            hx-get={`/fragments/player/${player.puuid}`}
            hx-target={`#${bodyId}`}
            hx-trigger="change"
            hx-push-url="true"
            hx-indicator={`#${spinnerId}`}
            hx-swap="innerHTML"
          >
            <div class="flex flex-col gap-1.5">
              <Label for={`since-${player.puuid}`}>Since</Label>
              <Select id={`since-${player.puuid}`} name="since">
                {SINCE_OPTIONS.map((opt) => (
                  <option value={opt.value} selected={opt.value === filters.since}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for={`queue-${player.puuid}`}>Queue</Label>
              <Select id={`queue-${player.puuid}`} name="queue">
                {QUEUE_OPTIONS.map((opt) => (
                  <option value={opt.value} selected={opt.value === filters.queue}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </form>
        </CardContent>
      </Card>

      <div class="flex items-center justify-end text-sm">
        <span id={spinnerId} class="htmx-indicator text-muted-foreground">
          Loading…
        </span>
      </div>

      <div id={bodyId}>
        <PlayerProfileBody data={data} />
      </div>
    </div>
  );
};
