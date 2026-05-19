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

`--platform` is the Riot platform code: `euw1`, `eun1`, `na1`, `kr`, `jp1`, `oc1`, `br1`, `la1`, `la2`, `tr1`, `ru`, `ph2`, `sg2`, `th2`, `tw2`, `vn2`.

`--queue` accepts `soloq`, `flex`, `ranked` (= solo+flex), `normal`, `aram`, `arena`, or a raw numeric queue id.

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
- `/fragments/match/:matchId[/stats|/timeline|/gold]` — htmx-loaded match-detail tabs (Overview, Stats, Timeline, Gold Graph) expanded from a row.

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

## Roadmap (v2)

- Per-player profile view (winrate, top champs, role distribution).
- Comparative leaderboards across the friend group.
- Streak / "tilt" detection.
- Time-of-day and day-of-week heatmaps.
- Web UI — likely Next.js reading the same SQLite (or Postgres if it outgrows).
- Live-game lookup via Spectator-V5.
