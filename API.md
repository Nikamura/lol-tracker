# lol-tracker API v1

Use this public, read-only JSON API to read the tracker’s stored players, ranks,
match statistics, and match details. No authentication, token, or Riot API key is
required. Requests read the local cache: they do not call Riot, consume Riot API
quota, trigger polling, or add accounts to the tracker.

This guide is served at `/API.md` and `/api/v1/API.md`. **The origin from which you
fetched this guide is the tracker origin.** Resolve every API path below against
that origin; do not derive a different host from player names or example values.
For example, a guide at `https://your-tracker.example/API.md` describes the API at
`https://your-tracker.example/api/v1`. That hostname is a placeholder.
JSON API responses advertise this guide with
`Link: </API.md>; rel="describedby"; type="text/markdown"`. Both guide URLs serve
the same file as `text/markdown; charset=utf-8` with `Cache-Control: no-cache`.

## Requests and responses

Use `GET` for JSON. `HEAD` is supported but has no response body. Other methods
return `405` with `Allow: GET, HEAD`. Responses use `Cache-Control: no-store`.
There are four JSON endpoints; the guide itself is Markdown, not JSON.

| Path under `/api/v1` | Successful `data` |
|---|---|
| `/players` | `PlayerSummary[]`: the complete tracked roster |
| `/players/resolve` | `PlayerSummary`: one tracked account by full Riot ID |
| `/players/:puuid` | `PlayerProfile`: ranks and filtered match statistics |
| `/matches/:matchId` | `MatchDetail`: one stored match and its participants |

Successful JSON responses have this envelope. All fields shown in this guide
are present; nullable fields use JSON `null` rather than being omitted.

```ts
interface Meta { generatedAt: number; source: "cached" }
interface ProfileMeta extends Meta {
  since: string; sinceMs: number | null;
  queue: string; queueIds: number[] | null; recentLimit: number;
}
interface Result<T, M = Meta> { data: T; meta: M }
interface ErrorResult { error: { code: string; message: string } }
```

All timestamps are Unix **milliseconds**. `gameDuration` is **seconds**.
`winrate` is a fraction from 0 to 1; multiply by 100 for a percentage.
Check HTTP status before reading `data`. Errors have no success envelope:

| HTTP status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_query` | Missing, malformed, or unknown query parameter |
| 404 | `player_not_found` | No matching tracked account or current PUUID |
| 404 | `match_not_found` | Match is not stored |
| 404 | `not_found` | Unknown API route |
| 405 | `method_not_allowed` | Request method is not GET or HEAD |
| 409 | `ambiguous_player` | Full Riot ID matches multiple tracked accounts |
| 500 | `internal_error` | Tracker could not read its data |

Unknown query parameters are rejected, including on endpoints that accept none.
Send each parameter once. Use URL encoding for path identifiers and
`URLSearchParams` or `curl --data-urlencode` for query values.

## Tracked players and account resolution

`GET /players` accepts no query parameters. It returns all tracked players,
ordered by display name then game name. There is no pagination.

`GET /players/resolve` requires `gameName` and `tagLine`, supplied separately:
`Faker#KR1` becomes `gameName=Faker&tagLine=KR1`. Both are trimmed, must contain
1–100 characters after trimming, and match the **entire stored value** without
case sensitivity. Display names and partial matches are not accepted.

Optional `platform` narrows the match. It is trimmed and case-insensitive; valid
values are `na1`, `br1`, `la1`, `la2`, `euw1`, `eun1`, `tr1`, `ru`, `kr`, `jp1`,
`oc1`, `ph2`, `sg2`, `th2`, `tw2`, and `vn2`. For a `409`, inspect the roster and
specify the chosen account’s platform, or use its roster PUUID directly. Resolve
only finds accounts already tracked; it does not search Riot or register anyone.

```ts
interface PlayerSummary {
  puuid: string; gameName: string; tagLine: string; riotId: string;
  displayName: string | null; platform: string; region: string;
  profilePath: string;
  lastPlayedAt: number | null; lastPolledAt: number | null;
  lastRankAt: number | null; lastMasteryAt: number | null;
}
```

`riotId` is `gameName + "#" + tagLine`. `profilePath` is a relative human-facing
tracker page, `/players/<encoded-puuid>`; resolve it against the same origin.
`platform` is the game platform; `region` is the stored routing region.

## Player profile

`GET /players/:puuid` uses a PUUID returned by the roster or resolver.

| Query parameter | Default | Accepted values |
|---|---|---|
| `since` | `30d` | `all`, or integer 1–999999 followed by lowercase `m`, `h`, or `d`; no leading zero |
| `queue` | `all` | Named group below, `all`, or 1–6 decimal digits representing a nonnegative queue ID |
| `recentLimit` | `10` | Decimal integer 1–50 |

`since` means a rolling window relative to request time: minutes, hours, or
24-hour days. The lower bound includes matches whose `gameStart >= sinceMs`.
`all` removes the lower bound. Queue input is trimmed and case-insensitive.

| Queue group | Included queue IDs |
|---|---|
| `ranked` | 420, 440 |
| `soloq` | 420 |
| `flex` | 440 |
| `normal` | 400, 430, 490 |
| `aram` | 450 |
| `mayhem` | 2400 |
| `arena` | 1700 |
| `all` | No queue filter |

Numeric queue IDs need not appear in that table. For example, `queue=1710`
selects that exact queue; the named `arena` group currently includes only 1700.

The response is `Result<PlayerProfile, ProfileMeta>`. The metadata echoes the
normalized parameters and their resolved filters. `sinceMs` and `queueIds` are
`null` for their respective `all` values. `recentLimit` is returned as a number.

```ts
interface PlayerProfile {
  player: PlayerSummary;
  currentRank: { solo: CurrentRank | null; flex: CurrentRank | null };
  headline: ProfileHeadline; roles: RoleStat[]; champions: ChampionStat[];
  recentMatches: RecentMatch[];
}
interface CurrentRank {
  queueType: string; tier: string; division: string | null;
  leaguePoints: number; wins: number; losses: number; capturedAt: number;
}
interface ProfileHeadline {
  games: number; wins: number; losses: number; winrate: number;
  avgKda: number; csPerMin: number; goldPerMin: number;
  visionPerGame: number; dmgToChampsPerMin: number;
}
interface RoleStat {
  position: string; games: number; wins: number; winrate: number;
}
interface ChampionStat {
  championId: number; championName: string; games: number;
  wins: number; winrate: number; avgKda: number;
}
interface RecentMatch {
  matchId: string; gameStart: number; gameDuration: number;
  queueId: number; gameMode: string; championName: string;
  teamPosition: string | null; win: boolean;
  kills: number; deaths: number; assists: number; kda: number;
  cs: number | null; goldEarned: number | null; visionScore: number | null;
  gameEndedInSurrender: boolean | null; teamEarlySurrendered: boolean | null;
}
```

Filters apply to `headline`, `roles`, `champions`, and `recentMatches`. These
exclude matches shorter than 300 seconds, the tracker’s remake rule. A tracked
player without matching history still returns `200`, zero headline values, and
empty arrays. `recentLimit` bounds only the recent sample, not the aggregates.
There is no offset, cursor, or additional page of recent matches in this API.

`roles` are played team positions, ordered by games descending; missing/empty
positions are omitted. These are observations, not declared preferences. Use
`ranked`, `soloq`, or `flex` when interpreting Summoner’s Rift positions.
`champions` contains at most five entries, ordered by games descending, and
measures games played rather than mastery. Tied role/champion counts have no
guaranteed secondary order. Recent matches are newest first by `gameStart`.

`avgKda` is `(total kills + total assists) / total deaths`, with the numerator
used directly when deaths are zero; it is not a mean of per-game KDA ratios.
Per-minute headline values divide totals by total minutes. Missing CS, gold,
vision, or champion-damage inputs contribute zero to headline totals.
Recent-match `kda` uses the same zero-death rule for that one game. Its `cs` sums
lane and neutral minions, treating a missing component as zero; it is `null`
when both components are missing.

## Stored match detail

`GET /matches/:matchId` accepts no query parameters. Pass a `matchId` from a
recent match. It returns all stored participants, including untracked players,
ordered by `teamId` ascending; order within a team is not guaranteed.
Unlike profile statistics, direct match lookup can return a stored remake.

```ts
interface MatchDetail {
  matchId: string; gameStart: number; gameDuration: number;
  queueId: number; gameMode: string; participants: MatchParticipant[];
}
interface MatchParticipant {
  puuid: string; teamId: number; championName: string;
  teamPosition: string | null; win: boolean;
  kills: number; deaths: number; assists: number;
  goldEarned: number | null; totalMinionsKilled: number | null;
  neutralMinionsKilled: number | null; visionScore: number | null;
  totalDamageDealtToChampions: number | null; totalDamageTaken: number | null;
  damageDealtToObjectives: number | null; champLevel: number | null;
  item0: number | null; item1: number | null; item2: number | null;
  item3: number | null; item4: number | null; item5: number | null;
  item6: number | null; riotIdGameName: string | null;
  riotIdTagline: string | null; trackedDisplayName: string | null;
}
```

Participant Riot ID fields describe stored match data and can differ from the
current roster identity. `trackedDisplayName` comes from the current tracked
roster; `null` can mean an untracked account or a tracked account without a
display name. It is not a reliable tracked-membership flag. Numeric item IDs
are provided without an item-name/static-data lookup.

## Freshness, identity, and party scheduling

`meta.generatedAt` is response-generation time, **not** source refresh time.
`lastPlayedAt` is the newest stored non-remake game **start** across all queues
and dates, independent of profile filters. `lastPolledAt` records the match-poll
cursor timestamp. `lastRankAt` and `lastMasteryAt` record their respective ingest
updates; a `null` timestamp means no recorded update. None promises complete
historical coverage or a live status.

`currentRank.solo` uses `RANKED_SOLO_5x5`; `flex` uses `RANKED_FLEX_SR`. Each is
the latest stored snapshot for its queue, independent of profile filters, or
`null` when no usable snapshot exists. Check the rank’s own `capturedAt` before
calling it current: a later successful rank poll can return no entry and leave
an older snapshot in storage. `lastRankAt` does not prove that the returned rank
was captured then. A null rank should be presented as unavailable, not proof of
the player’s current unranked status.

For five-stack-bot, explicitly link a verified Telegram user ID to a selected
tracked account. Store that tracker-origin/PUUID reference plus the chosen full
Riot ID and platform. Do not infer ownership from similar display names or
Telegram usernames. PUUIDs are references in this tracker’s current identity
namespace; a tracker rekey after a Riot key change can change them. If a saved
PUUID returns `404`, re-resolve the saved full Riot ID/platform and verify the
intended account. Riot IDs can change too; request an explicit relink if needed.

Cached match history does not establish online status, an ongoing game, or
availability tonight. Keep the bot’s availability answers authoritative. Read
tracker data from the bot backend with a timeout, and keep ordinary scheduling
working if the tracker is unavailable. This API does not implement account
linking, party selection, or writes to either application.

## Worked requests

Set the origin to the host serving this guide. These example names must refer
to an account actually present in that tracker. This shell flow uses `jq`:

```sh
TRACKER_ORIGIN='https://your-tracker.example'
curl --fail-with-body "$TRACKER_ORIGIN/api/v1/players"
PLAYER_JSON=$(curl --fail-with-body --get \
  "$TRACKER_ORIGIN/api/v1/players/resolve" \
  --data-urlencode 'gameName=Faker' --data-urlencode 'tagLine=KR1' \
  --data-urlencode 'platform=kr')
PUUID_PATH=$(printf '%s' "$PLAYER_JSON" | jq -r '.data.puuid | @uri')
PROFILE_JSON=$(curl --fail-with-body --get \
  "$TRACKER_ORIGIN/api/v1/players/$PUUID_PATH" \
  --data-urlencode 'since=30d' --data-urlencode 'queue=ranked' \
  --data-urlencode 'recentLimit=5')
MATCH_PATH=$(printf '%s' "$PROFILE_JSON" | jq -r '.data.recentMatches[0].matchId // empty | @uri')
if [ -n "$MATCH_PATH" ]; then
  curl --fail-with-body "$TRACKER_ORIGIN/api/v1/matches/$MATCH_PATH"
fi
```

Node.js backend example, using built-in `fetch`. Save as `client.mjs` and run
`node client.mjs https://your-tracker.example/API.md Faker KR1 kr` with your
guide URL and tracked account. The final platform argument is optional.

```js
const [guideUrl, gameName, tagLine, platform] = process.argv.slice(2);
if (!guideUrl || !gameName || !tagLine) throw new Error("Supply guide URL, gameName, tagLine, [platform]");
const origin = new URL(guideUrl).origin;
async function get(path, query = {}) {
  const url = new URL(`/api/v1${path}`, origin);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.error?.code ?? "request_failed"}`);
  return body;
}
try {
  const query = { gameName, tagLine, ...(platform ? { platform } : {}) };
  const { data: player } = await get("/players/resolve", query);
  const profile = await get(`/players/${encodeURIComponent(player.puuid)}`, {
    since: "30d", queue: "ranked", recentLimit: "5",
  });
  console.log(player.riotId, profile.data.headline, profile.data.currentRank);
  const latest = profile.data.recentMatches[0];
  if (latest) {
    const { data: match } = await get(`/matches/${encodeURIComponent(latest.matchId)}`);
    console.log(match);
  }
} catch (error) {
  console.error("Tracker data unavailable:", error.message);
  // A party bot continues its normal scheduling flow here.
}
```
