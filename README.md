# lol-tracker

Tracks League of Legends matches played by a configured list of friends. Polls the Riot API on a schedule and stores everything in SQLite for later analysis.

v1 is a CLI: ingestion + a unified chronological timeline. Per-player dashboards, leaderboards, and graphing are intentionally deferred (the raw match JSON is preserved so v2 can run on the existing data).

## Quickstart

```bash
pnpm install
cp .env.example .env       # add your RIOT_API_KEY

# Add players
pnpm dev add "Faker#KR1"  --platform kr   --name Faker
pnpm dev add "Caps#EUW"   --platform euw1 --name Caps

# Fetch matches
pnpm dev poll              # last 7 days for new players, incremental thereafter

# View the unified feed
pnpm dev timeline --since 7d
pnpm dev timeline --player Faker --queue soloq --limit 20
```

Production-ish: `pnpm build && node dist/cli.js …` or `npm link` to expose `lol-tracker` on `$PATH`.

## Getting a Riot API key

1. Sign in at <https://developer.riotgames.com>.
2. The personal dev key on the dashboard works but expires every 24h — fine for local hacking.
3. For homelab/cron use, apply for a **Personal API Key** (the long-lived one). Approval is usually fast for non-public tools.

Dev-key rate limits: 20 req/s · 100 req / 2 min. The client honours both with a token bucket and respects `Retry-After` on 429.

## Commands

| | |
|-|-|
| `add <gameName#tagLine> --platform <p> [--name <n>]` | Resolve a Riot ID to a PUUID and start tracking. |
| `remove <gameName#tagLine> [--purge-matches] [--yes]` | Stop tracking a player and cascade-delete their unique data (rank snapshots, mastery, ingest cursor). |
| `list` | Show tracked players and when each was last polled. |
| `poll [--backfill-days 7] [--skip-timelines] [--skip-rank] [--skip-mastery] [--mastery-stale-hours 24] [--verbose]` | Incremental fetch for all tracked players. |
| `rekey [--dry-run] [--rewrite-json] [--verbose]` | Rotate PUUIDs after a Riot API key change. Re-resolves every tracked Riot ID and updates every table keyed on PUUID. |
| `serve [--port 5173] [--poll-interval 600] [--backfill-days 7] [--skip-initial-poll]` | Run the web UI **and** auto-poll on an interval. Container default. |
| `timeline [--since 7d] [--player <n>] [--queue <q>] [--limit 100]` | Chronological feed across everyone. |
| `mcp [--port 3333] [--host 127.0.0.1] [--stdio]` | Stand-alone MCP server (HTTP by default, `--stdio` for desktop clients). Read-only — no Riot key needed. `serve` also mounts `/mcp` automatically. |

`--platform` is the Riot platform code: `euw1`, `eun1`, `na1`, `kr`, `jp1`, `oc1`, `br1`, `la1`, `la2`, `tr1`, `ru`, `ph2`, `sg2`, `th2`, `tw2`, `vn2`.

`--queue` accepts `soloq`, `flex`, `ranked` (= solo+flex), `normal`, `aram`, `mayhem`, `arena`, or a raw numeric queue id.

`--since` accepts `30m`, `12h`, `7d`.

## Data model

SQLite at `./data/lol-tracker.db` (configurable via `LOL_TRACKER_DB`). Schema is defined in `src/db/schema.ts` with [Drizzle ORM](https://orm.drizzle.team) and migrated via [drizzle-kit](https://orm.drizzle.team/kit-docs/overview). Migrations live in `drizzle/` and run automatically when the CLI opens the DB.

- `players` — one row per tracked Riot ID, keyed by PUUID.
- `matches` — one row per match. The **full Match-V5 JSON** lives in `raw_json` (JSON mode, auto-parsed) so v2 analyses can mine anything we didn't project.
- `match_participants` — denormalised per-player columns for every queryable stat: KDA, champ, role, gold, CS, vision, full damage breakdown, items 0–6, summoner spells, perks (with `perks_json` for full rune page), `challenges_json` (Riot's ~150 pre-computed analytics fields), surrender flags, multikills, objectives.
- `match_timelines` — per-frame events + per-minute snapshots per match (full JSON). Costs one extra Riot request per match.
- `player_rank_snapshots` — solo/flex tier, rank, LP, W/L captured at each poll. Lets you graph LP over time.
- `player_mastery` — mastery points & level per champion per player. Refreshed every 24h by default.
- `ingest_state` — per-player cursors: `last_match_start`, `last_rank_at`, `last_mastery_at`.
- `meta` — singleton key/value store; today holds `riot_key_fingerprint` (first 16 hex chars of `SHA-256(RIOT_API_KEY)`) so `poll` / `serve` can detect a key rotation and refuse to run until `lol-tracker rekey` is invoked.

WAL mode + `onConflictDoNothing()` on matches means concurrent polls are safe and reruns are idempotent.

### Drizzle workflow

```bash
pnpm db:push       # apply schema changes directly — best during iteration
pnpm db:generate   # commit a migration file in drizzle/NNNN_*.sql
pnpm db:migrate    # apply pending migrations (the CLI does this on startup too)
pnpm db:studio     # open Drizzle Studio against the live DB
pnpm db:reset      # wipe the local SQLite file (data + WAL)
```

Both `players.platform` and `players.region` are stored as plain `TEXT`; validation happens at the `add` command via the `isPlatform` type guard. Riot API responses are validated with `zod` schemas in `src/riot/types.ts` (`.passthrough()` so new Riot fields don't break ingest).

### Dev loop

The CLI is one-shot, so `pnpm dev <args>` runs it through `tsx` — no `build` step needed:

```bash
# Terminal 1 — ambient type errors while you edit
pnpm watch

# Terminal 2 — run anything
pnpm dev add "Faker#KR1" --platform kr --name Faker
pnpm dev poll --skip-timelines
pnpm dev timeline --since 24h

# Iterating on the schema:
#   1. edit src/db/schema.ts
#   2. pnpm db:push          # fast — skips writing a migration file
#   3. pnpm dev poll         # try it
# Once happy, commit a real migration:
#   pnpm db:generate

# Smoke tests (no Riot key needed — they exercise the local DB + zod parsers)
pnpm smoke
```

If anything ever wedges, `pnpm db:reset` wipes the file and the next CLI invocation recreates everything from migrations.

### Riot endpoints used

| Endpoint | Routing | What we store |
|-|-|-|
| `account-v1/accounts/by-riot-id` | regional | resolve Riot ID → PUUID at `add` time |
| `match-v5/matches/by-puuid/.../ids` | regional | list of new match IDs since last cursor |
| `match-v5/matches/{id}` | regional | full match → `matches` + `match_participants` |
| `match-v5/matches/{id}/timeline` | regional | per-frame events → `match_timelines` (skip with `--skip-timelines`) |
| `league-v4/entries/by-puuid` | platform | rank snapshot per poll → `player_rank_snapshots` (`--skip-rank`) |
| `champion-mastery-v4/.../by-puuid` | platform | mastery refresh ≥ 24h apart → `player_mastery` (`--skip-mastery`, `--mastery-stale-hours`) |

The public queue catalog identifies ARAM Mayhem as queue `2400`, so the UI and
CLI recognize that queue label/filter if Riot returns such a match. Match-V5
history currently omits Mayhem games, however, and League Classic has no public
Match-V5 queue/history support. The tracker deliberately does not use local
League Client APIs, so those games will remain absent until Riot exposes them.

API cost per poll cycle (rough): `N players × (1 list + 1 rank + 1 mastery)` + `M new matches × 2 (match + timeline)`. With a personal-key limit of 100 req / 2 min, an idle group of 5 players costs ~15 req/poll; an active poll picking up 5 new matches per player costs ~65 req/poll (≈80s under the cap).

## Web UI (v2, in progress)

A small read-only browser UI built with **Hono + HTMX** and Tailwind v4. Server-renders the same data the CLI exposes — no React, no SPA build.

```bash
pnpm dev:web      # tsx watch + tailwind --watch in parallel; serves http://localhost:5173
pnpm web          # one-shot web-only (assumes public/app.css is already built)
pnpm dev serve    # web + recurring auto-poll in one process (what the container runs)
pnpm web:css      # build the stylesheet
```

Pages:

- `/` — party-grouped timeline (solo matches and stacks rendered side-by-side, grouped by team) with HTMX-driven filters (since / queue / player / limit). The filter form posts to `/fragments/timeline`, which returns an HTML fragment swapped into the page.
- `/players` — tracked players with last-poll and last-match timestamps.
- `/matches/:matchId` — shareable full match page with overview, stats and available timeline/graph tabs; used by Telegram result links.
- `/fragments/match/:matchId[/stats|/timeline|/champions|/graphs]` — htmx-loaded match-detail tabs (Overview, Stats, Timeline, Champions, Graphs) expanded from a row.

The Graphs tab compares every champion's damage dealt to champions, damage taken
from all sources, CS (lane + jungle), total gold, level, and XP over game time.
Champion checkboxes and All / Tracked / team presets control which lines appear.
Hover or use the keyboard/touch time slider to read values at a shared timestamp.
Team gold lead uses **blue minus red**, independent of champion selection, with
peak leads retained. Blue champion lines are solid and red lines are dashed.

Graphs use existing cached Match-V5 timeline snapshots; no new Riot requests,
database migration, or client installation is needed. Missing fields create gaps,
levels are not capped at 18, and the final partial-minute timestamp is retained.
Level steps reflect sampled levels, not exact level-up event times. Matches without
a timeline keep these tabs disabled. Link directly with
`/matches/:matchId?tab=graphs`; the old `/fragments/match/:matchId/gold` URL still
opens team gold lead.

The Graphs tab also offers a head-to-head comparison at the selected sample,
10/15/20-minute checkpoints (using the nearest sample within 30 seconds and
labeling its actual time),
play/pause controls, objective markers, and clickable key moments. The initial
pair uses a tracked champion and an opponent with the same recorded role when
available. Largest gold swing measures the change between adjacent complete
samples; it is not a prediction or a claim about what caused the swing. Playback
advances snapshots and stops on tab removal, a hidden document, or the final sample.

The Champions tab shows per-minute output, physical/magic/true damage, team
contribution shares, skill-point order with exact recorded timestamps, and the
purchase/sale/undo ledger for each champion. Skill evolutions are not counted as
normal points. Item names load from the match patch's official Data Dragon catalog,
with item IDs retained if the catalog cannot load. Missing timelines still allow
final champion analysis, with explicit empty states for skills and shopping.
`/matches/:matchId?tab=champions` opens this view directly. Other detail tabs also
accept their name in the `tab` query parameter.

The Timeline tab filters by champion involvement (including deaths and assists)
and event type, with recognized ward placements/destructions included. Unknown
ward types are omitted because Riot can use them for non-ward champion objects.
Blitz's rank-population benchmarks and win-probability model are outside this
change: the local archive does not contain the data/model needed to reproduce them.
Run `pnpm smoke:graphs` for isolated calculation and route checks.

Match detail also computes a 0–100 **performance score** per participant — global #1 gets the `MVP` badge, lowest score on each team gets `COOKED`. Tracked players show their solo-queue rank inline.

The visual style mirrors shadcn/ui (semantic Tailwind tokens, Card + Table + Badge patterns), but components are hand-rolled JSX under `src/web/components/ui.tsx` so they render in Hono's JSX runtime instead of React.

## Homelab deploy

The container's default command is `serve`: it boots the web UI on port `5173`
and auto-polls Riot every `POLL_INTERVAL_SECONDS` (default 600 = 10 min) in the
same process. No host-side cron, systemd timers, or scheduled `docker run`
needed — bring the stack up and leave it.

```bash
# On the homelab box (assumes Docker + compose plugin)
sudo mkdir -p /opt/lol-tracker /opt/lol-tracker/data
sudo rsync -a ./ /opt/lol-tracker/      # or git clone
cd /opt/lol-tracker
echo "RIOT_API_KEY=RGAPI-..." | sudo tee .env

sudo docker compose up -d --build

# Add players (one-shot 'docker compose exec' against the running container)
sudo docker compose exec lol-tracker node dist/cli.js add "Faker#KR1" --platform kr --name Faker

# Watch what's happening
sudo docker compose logs -f lol-tracker

# UI is on http://<host>:5173
```

Environment knobs (set in `.env` or `docker-compose.yml`):

| Var | Default | Purpose |
|-|-|-|
| `RIOT_API_KEY` | *(required)* | Riot personal/dev key |
| `PORT` | `5173` | HTTP port the container listens on |
| `POLL_INTERVAL_SECONDS` | `600` | Poll cadence. Set to `0` to disable auto-poll. |
| `BACKFILL_DAYS` | `7` | History window for newly added players |
| `LOL_TRACKER_DB` | `/data/lol-tracker.db` | DB path inside the container |
| `LOL_TRACKER_PUBLIC_URL` | Request origin | Public HTTP(S) origin for canonical URLs, social images, JSON-LD and sitemaps (for example `https://lol-tracker.cn.lt`). Set explicitly behind a proxy; no path, credentials or query. |

Database lives in `./data/` on the host (bind-mounted to `/data` in the container)
so backups are just an rsync of that directory. `restart: unless-stopped` keeps
the container alive across reboots.

The image still exposes the full CLI — useful for one-shot ops like adding
players, running an immediate poll, or pulling a timeline from inside the
container: `docker compose exec lol-tracker node dist/cli.js <subcommand>`.

## Rotating your Riot API key

Riot encrypts PUUIDs with a key tied to your API key, so when you rotate the key
every stored PUUID becomes an opaque blob the new key can't decrypt (you'll see
`400 Exception decrypting <puuid>` on every PUUID-keyed endpoint). `rekey`
fixes this:

```bash
# After editing .env with the new RIOT_API_KEY
pnpm dev rekey --dry-run        # preview which players will be rotated
pnpm dev rekey                  # rotate puuids across players, match_participants,
                                # player_rank_snapshots, player_mastery, ingest_state
pnpm dev rekey --rewrite-json   # also rewrite puuids inside matches.raw_json
                                # and match_timelines.raw_json (slower; only
                                # needed if v2 code mines the raw JSON)
```

Mechanically, `rekey` calls Account-V1 (`by-riot-id/<gameName>/<tagLine>`) with
the new key for each tracked player — that lookup is name-keyed, not PUUID-keyed,
so it works regardless of which key issued the original PUUID — then updates
every table inside a single SQLite transaction (with `PRAGMA defer_foreign_keys`
to satisfy the FKs on `players.puuid`). A SHA-256 fingerprint of the API key
is stored in `meta` so `poll` refuses to run, and `serve` disables auto-poll,
until `rekey` has caught up with the new key.

## Service API (five-stack-bot)

`serve` and the web-only entry point mount a public, read-only JSON API at
`/api/v1`. It provides tracked-player lookup, solo/flex rank, recent matches,
role/champion statistics, and match details from cached SQLite data. No token
or authorization header is required; requests do not call Riot or trigger polling.

The complete consumer contract is [API.md](API.md), served as Markdown at
`GET /API.md` and `GET /api/v1/API.md` on the tracker. Give another agent the
running tracker's `/API.md` URL to integrate without access to this repository.
API responses also advertise the guide through a `Link: ...; rel="describedby"`
header. The guide is included in the Docker image and covers request examples,
response types, query limits, error handling, freshness, and account linking.

```bash
curl --fail http://localhost:5173/API.md
curl --fail http://localhost:5173/api/v1/players
```

Run isolated API and documentation checks with `pnpm smoke:api`.

## MCP server

The `serve` command exposes an [MCP](https://modelcontextprotocol.io) endpoint at `POST /mcp` alongside the web UI — so the existing homelab container already hosts it (`http://<host>:5173/mcp`) with no extra config. `lol-tracker mcp` is also available as a stand-alone process for non-`serve` deployments.

The server reads the local SQLite — it never calls Riot, so it doesn't need an API key.

Tools exposed:

- `list_players` — every tracked Riot ID with ingest cursors.
- `query_timeline` / `query_parties` — chronological match feed (per-row or grouped by team), filters: `since` (`7d`/`12h`), `sinceMs`/`untilMs`, `players` (substring), `puuids`, `queue` (`soloq`/`flex`/`ranked`/`normal`/`aram`/`mayhem`/`arena`/numeric), `limit`.
- `get_match` — full per-participant breakdown of a match (both teams, opponents included).
- `get_player_profile` — per-player aggregate, lean by default. Pick sections with `include` (`headline`, `currentRank`, `rankHistory`, `roles`, `champions`, `mastery`, `recentMatches`, `improvementSignals`); paginate `recentMatches`/`champions`/`mastery` via `*Limit`/`*Offset`; flip `recentMatchesDetail` to `full` for item & perk IDs; flip `rankHistoryDetail` to `full` for raw polls. Default response is the headline + current rank + roles + top 5 champions + last 5 matches (summary) + `improvementSignals` (worst/best role and champ, surrender rate, deaths trend, last-10 form). For pointed questions ("last game played", "who did X duo with last week") prefer `query_sql` — it's faster and never overflows.
- `get_leaderboards` — group-wide winrate, KDA, CS/min, vision, damage, gold, objectives, surrender rate.
- `query_sql` — read-only `SELECT`/`WITH` escape hatch (mutating statements rejected).

### Add to an AI client (HTTP)

Point any MCP-over-HTTP client at the `serve` container:

```jsonc
{
  "mcpServers": {
    "lol-tracker": { "url": "http://homelab.lan:5173/mcp" }
  }
}
```

The transport is stateless (no session ID; safe behind a plain reverse proxy). **There's no auth on `/mcp`** — keep it on a trusted network, or front it with whatever you already use for the web UI.

### Stand-alone hosting

If you don't want the web UI (or want MCP on its own port), run the server directly:

```bash
pnpm dev mcp                              # → http://127.0.0.1:3333/mcp
pnpm dev mcp --port 3333 --host 0.0.0.0   # bind all interfaces
```

A `GET /health` endpoint returns `ok` for uptime checks.

### Local (stdio)

```jsonc
{
  "mcpServers": {
    "lol-tracker": {
      "command": "node",
      "args": ["/opt/lol-tracker/dist/cli.js", "mcp", "--stdio"],
      "env": { "LOL_TRACKER_DB": "/opt/lol-tracker/data/lol-tracker.db" }
    }
  }
}
```

## Roadmap (v2)

- Per-player profile view (winrate, top champs, role distribution).
- Comparative leaderboards across the friend group.
- Streak / "tilt" detection.
- Time-of-day and day-of-week heatmaps.
- Web UI — likely Next.js reading the same SQLite (or Postgres if it outgrows).
- Live-game lookup via Spectator-V5.

## Search and sharing

HTML responses include page-specific titles/descriptions, canonical URLs, Open
Graph/X cards and escaped JSON-LD (`WebSite`, `WebPage`, `CollectionPage`,
`AboutPage`, and visible `BreadcrumbList` where applicable). Match previews use
the recorded queue, date, duration and tracked champion/player identities. The
shared social artwork is `public/og.png` (1200×630), with editable source
`public/og.svg`. Raster browser/touch icons and `site.webmanifest` are also served.
No account-verification tags or social handles are fabricated.

`/matches` is a paginated archive of ordinary match links. `/sitemap.xml` is a
sitemap index: `/sitemaps/pages.xml` covers site sections and tracked profiles;
`/sitemaps/matches-N.xml` covers every stored match, 1,000 URLs per document.
These queries select only discovery fields, not full Riot payloads. We omit
`lastmod` because ingestion timestamps do not capture every later page change.
Filters are `noindex,follow`; match tabs consolidate to the match canonical URL,
and archive pagination has distinct canonical URLs. Errors, HTMX fragments,
refresh and machine API/MCP responses carry `X-Robots-Tag: noindex,follow`.
Robots.txt permits fetching so crawlers can see those directives.

`/about` explains data sources, statistical definitions and coverage limits.
`/llms.txt` is an optional navigation guide for assistants, pointing to the same
visible pages and public `/API.md`; it is not a ranking guarantee or a substitute
for useful crawlable content. Charts retain server-rendered text/table fallbacks.

Run `pnpm smoke:seo` for metadata, JSON-LD safety, crawler headers, sitemap/archive
pagination and social-image checks. It is included in `pnpm smoke` and CI. When
changing SVG artwork, regenerate and visually inspect the committed PNGs. After
deployment, verify the public canonical origin and fetch the share image with
social crawler user agents. Submit `/sitemap.xml` in an owner-verified Search
Console or Bing Webmaster Tools property if configured; verification credentials
and indexing decisions are external to the application.
