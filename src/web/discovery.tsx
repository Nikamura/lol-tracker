import { asc, count, desc } from "drizzle-orm";
import type { Hono } from "hono";
import type { DB } from "../db/connect.js";
import { matches, players } from "../db/schema.js";
import { queueLabel } from "../lib/queues.js";
import { resolveBaseUrl, type PageSeo } from "./seo.js";

const SITEMAP_SIZE = 1000;
const ARCHIVE_SIZE = 50;
const sections = [
  "/",
  "/matches",
  "/players",
  "/leaderboards",
  "/streaks",
  "/heatmaps",
  "/compare",
  "/daily",
  "/about",
];
const xmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const urlset = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`).join("")}</urlset>\n`;
const archivePath = (page: number) =>
  page === 1 ? "/matches" : `/matches?page=${page}`;

export function registerDiscovery(
  app: Hono<{ Variables: { active?: string; seo?: PageSeo } }>,
  db: DB,
) {
  app.get("/about", (c) => {
    c.set("seo", {
      title: "About & methodology · lol-tracker",
      type: "AboutPage",
      path: "/about",
      description:
        "How lol-tracker collects League of Legends matches, calculates friend-group statistics and handles missing data. Explore the read-only data API.",
      breadcrumbs: [
        { name: "Home", path: "/" },
        { name: "About & methodology", path: "/about" },
      ],
    });
    return c.render(
      <article class="mx-auto max-w-3xl space-y-8 py-8 text-sm leading-relaxed">
        <header class="space-y-3">
          <span class="scoreboard-eyebrow">THE ARCHIVE · EXPLAINED</span>
          <h1 class="font-display text-4xl">ABOUT LOL / TRACKER</h1>
          <p class="text-base text-muted-foreground">
            A League of Legends match archive for a configured group of friends.
            Follow shared games, explore champion performance and compare the
            group's recorded results.
          </p>
        </header>
        <section class="space-y-3">
          <h2 class="font-display text-2xl">Where the data comes from</h2>
          <p>
            Match results and timelines come from the{" "}
            <a
              class="underline"
              href="https://developer.riotgames.com/docs/lol"
            >
              Riot Games API
            </a>
            . Champion, item, rune and spell assets use Riot's Data Dragon. The
            tracker periodically collects available games for its tracked
            accounts and stores them locally.
          </p>
          <p>
            This is a cached archive, not a live spectator feed or a complete
            global database. A player profile and its statistics describe the
            games stored here, within the selected queue and time window.
            Missing matches and delayed updates can affect totals.
          </p>
        </section>
        <section class="space-y-3">
          <h2 class="font-display text-2xl">How to read the statistics</h2>
          <dl class="space-y-4">
            <div>
              <dt class="font-semibold">KDA and kill participation</dt>
              <dd class="text-muted-foreground">
                KDA is kills plus assists divided by deaths, with a minimum
                denominator of one. Kill participation is kills plus assists
                divided by the team's kills; when the team has no kills, it is
                zero.
              </dd>
            </div>
            <div>
              <dt class="font-semibold">CS and team share</dt>
              <dd class="text-muted-foreground">
                CS includes lane and neutral minion kills. Team share compares a
                player's recorded metric with the sum for their team. Missing
                values are not evidence of zero performance.
              </dd>
            </div>
            <div>
              <dt class="font-semibold">Champion graphs and builds</dt>
              <dd class="text-muted-foreground">
                Graphs use Riot's recorded timeline frames, not continuous
                measurements. Missing samples remain gaps. Skill upgrades and
                purchases come from timeline events; sales and undo events are
                shown as part of the item history.
              </dd>
            </div>
            <div>
              <dt class="font-semibold">Performance scores and awards</dt>
              <dd class="text-muted-foreground">
                The match score is a tracker-defined comparison using combat,
                vision, objectives, team support and victory. It is not Riot's
                rating, MMR or a universal measure of skill. Score details are
                available on the match overview. Daily awards compare recorded
                ranked Summoner's Rift games.
              </dd>
            </div>
            <div>
              <dt class="font-semibold">Ranks and time windows</dt>
              <dd class="text-muted-foreground">
                Rank information reflects collected snapshots. Match-time ranks
                may use the latest snapshot available before the match. Each
                view's queue, date and time-window controls determine which
                stored games contribute to its results.
              </dd>
            </div>
          </dl>
        </section>
        <section class="space-y-3">
          <h2 class="font-display text-2xl">Explore and use the archive</h2>
          <p>
            Start with the{" "}
            <a class="underline" href="/matches">
              match archive
            </a>
            ,{" "}
            <a class="underline" href="/players">
              player roster
            </a>{" "}
            or{" "}
            <a class="underline" href="/leaderboards">
              leaderboards
            </a>
            . Match pages offer results, champion analysis and graphs, with text
            tables alongside charts where available.
          </p>
          <p>
            The public{" "}
            <a class="underline" href="/API.md">
              read-only API guide
            </a>{" "}
            documents structured queries for analysis and assistants. It queries
            the same stored archive; it does not fetch arbitrary players or
            start ingestion.{" "}
            <a class="underline" href="/llms.txt">
              Machine-readable site guide
            </a>
            .
          </p>
        </section>
        <section class="space-y-3">
          <h2 class="font-display text-2xl">Independent project</h2>
          <p>
            lol-tracker is a community project and is not endorsed by Riot
            Games. League of Legends and its game assets belong to Riot Games.
          </p>
        </section>
      </article>,
    );
  });

  app.get("/matches", (c) => {
    const rawPage = c.req.query("page") ?? "1";
    if (!/^[1-9]\d{0,7}$/.test(rawPage)) return c.notFound();
    const page = Number(rawPage);
    const total = db.select({ value: count() }).from(matches).get()!.value;
    const pages = Math.max(1, Math.ceil(total / ARCHIVE_SIZE));
    if (page > pages) return c.notFound();
    const path = archivePath(page);
    c.set("seo", {
      title: `League of Legends match archive${page > 1 ? ` · Page ${page}` : ""} · lol-tracker`,
      description:
        "Browse recorded League of Legends games with permanent links to results, champion builds, player statistics and match graphs.",
      path,
      type: "CollectionPage",
      breadcrumbs: [
        { name: "Home", path: "/" },
        { name: "Match archive", path },
      ],
    });
    const rows = db
      .select({
        id: matches.matchId,
        started: matches.gameStart,
        queue: matches.queueId,
        mode: matches.gameMode,
        duration: matches.gameDuration,
      })
      .from(matches)
      .orderBy(desc(matches.gameStart), asc(matches.matchId))
      .limit(ARCHIVE_SIZE)
      .offset((page - 1) * ARCHIVE_SIZE)
      .all();
    return c.render(
      <div class="space-y-6 py-8">
        <header class="space-y-2">
          <span class="scoreboard-eyebrow">EVERY RECORDED GAME</span>
          <h1 class="font-display text-4xl">MATCH ARCHIVE</h1>
          <p class="text-muted-foreground">
            {total.toLocaleString("en-US")} recorded{" "}
            {total === 1 ? "match" : "matches"} · Page {page} of {pages}. Open a
            game for results, champion builds and graphs.
          </p>
        </header>
        {rows.length ? (
          <ul class="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => (
              <li>
                <a
                  class="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/30"
                  href={`/matches/${encodeURIComponent(row.id)}`}
                >
                  <span class="space-y-1">
                    <span class="block font-semibold">
                      {queueLabel(row.queue, row.mode)}
                    </span>
                    <span class="block text-sm text-muted-foreground">
                      {row.id}
                    </span>
                  </span>
                  <span class="text-sm text-muted-foreground">
                    <time datetime={new Date(row.started).toISOString()}>
                      {new Date(row.started)
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}{" "}
                      UTC
                    </time>{" "}
                    · {Math.floor(row.duration / 60)} min
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No matches have been recorded yet.</p>
        )}
        <nav
          aria-label="Match archive pages"
          class="flex justify-between gap-4"
        >
          {page > 1 ? (
            <a rel="prev" class="underline" href={archivePath(page - 1)}>
              ← Newer matches
            </a>
          ) : (
            <span />
          )}
          {page < pages && (
            <a rel="next" class="underline" href={archivePath(page + 1)}>
              Older matches →
            </a>
          )}
        </nav>
      </div>,
    );
  });

  app.get("/robots.txt", (c) =>
    c.text(
      `User-agent: *\nAllow: /\nSitemap: ${resolveBaseUrl(c.req.url)}/sitemap.xml\n`,
    ),
  );

  app.get("/sitemap.xml", (c) => {
    const base = resolveBaseUrl(c.req.url);
    const total = db.select({ value: count() }).from(matches).get()!.value;
    const paths = [
      "/sitemaps/pages.xml",
      ...Array.from(
        { length: Math.ceil(total / SITEMAP_SIZE) },
        (_, i) => `/sitemaps/matches-${i + 1}.xml`,
      ),
    ];
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<sitemap><loc>${xmlEscape(base + p)}</loc></sitemap>`).join("")}</sitemapindex>\n`,
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
    );
  });
  app.get("/sitemaps/pages.xml", (c) => {
    const base = resolveBaseUrl(c.req.url);
    const roster = db.select({ puuid: players.puuid }).from(players).all();
    return c.body(
      urlset(
        [
          ...sections,
          ...roster.map((p) => `/players/${encodeURIComponent(p.puuid)}`),
        ].map((p) => base + p),
      ),
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
    );
  });
  app.get("/sitemaps/:file", (c) => {
    const page = /^matches-([1-9]\d{0,7})\.xml$/.exec(c.req.param("file"));
    if (!page) return c.notFound();
    const rows = db
      .select({ id: matches.matchId })
      .from(matches)
      .orderBy(asc(matches.matchId))
      .limit(SITEMAP_SIZE)
      .offset((Number(page[1]) - 1) * SITEMAP_SIZE)
      .all();
    if (!rows.length) return c.notFound();
    const base = resolveBaseUrl(c.req.url);
    return c.body(
      urlset(rows.map((r) => `${base}/matches/${encodeURIComponent(r.id)}`)),
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
    );
  });
  app.get("/llms.txt", (c) => {
    const base = resolveBaseUrl(c.req.url);
    return c.text(
      `# lol-tracker\n\n> A cached League of Legends match archive for a configured group of friends, with champion graphs, builds, profiles and group comparisons.\n\n## Sources and scope\n\nMatch and timeline records originate from Riot Games APIs. Coverage is limited to stored games for tracked accounts; it is not a complete player history or global ranking. Missing data must not be treated as zero. Scores and daily awards are tracker-defined, not Riot ratings or MMR. Filters change the sample. Cite the canonical match or profile URL when using its data.\n\n## Pages\n\n- [About and methodology](${base}/about): Sources, definitions and limitations.\n- [Match archive](${base}/matches): Paginated, permanent match links.\n- [Players](${base}/players): Tracked accounts and profile links.\n- [Leaderboards](${base}/leaderboards): Friend-group statistics.\n- [Daily](${base}/daily): Recorded ranked games by day.\n- [Streaks](${base}/streaks): Consecutive results.\n- [Heatmaps](${base}/heatmaps): Play-time patterns.\n- [Comparisons](${base}/compare): Player comparisons.\n\n## Structured access\n\n- [API guide](${base}/API.md): Public, read-only archive API; follow its documented pagination and bounds.\n- [Sitemap index](${base}/sitemap.xml): Canonical pages, players and match records.\n\nUse full page URLs rather than /fragments/ UI responses. lol-tracker is independent and not endorsed by Riot Games.\n`,
    );
  });
}
