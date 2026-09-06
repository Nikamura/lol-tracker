import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/connect.js";
import { insertMatch, upsertPlayer } from "../src/db/queries.js";
import { Match } from "../src/riot/types.js";
import { createApp } from "../src/web/server.js";
import { resolveBaseUrl, resolveSeo } from "../src/web/seo.js";

const oldOrigin = process.env.LOL_TRACKER_PUBLIC_URL;
const dir = mkdtempSync(join(tmpdir(), "lol-seo-"));
const db = openDb(join(dir, "test.db"));
const base = "https://tracker.example";
const scriptName = '</script><script>alert("x")</script>';
const parseLd = (html: string) =>
  JSON.parse(
    html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )![1]!,
  );
try {
  process.env.LOL_TRACKER_PUBLIC_URL = base + "/";
  assert.equal(resolveBaseUrl("http://internal:5173/?a=b"), base);
  process.env.LOL_TRACKER_PUBLIC_URL = "https://user:secret@example.com/path";
  assert.throws(() => resolveBaseUrl("http://localhost"), /must be an HTTP/);
  process.env.LOL_TRACKER_PUBLIC_URL = base;
  const resolved = resolveSeo(
    { title: scriptName, description: scriptName, path: "/test" },
    base,
  );
  assert.ok(!resolved.jsonLd.includes("</script>"));
  assert.equal(JSON.parse(resolved.jsonLd)["@graph"][1].name, scriptName);
  upsertPlayer(db, {
    puuid: "P1",
    gameName: "Example",
    tagLine: "EUW",
    displayName: scriptName,
    platform: "euw1",
    region: "europe",
  });
  const fixture = Match.parse({
    metadata: { dataVersion: "2", matchId: "EUW1_seo", participants: ["P1"] },
    info: {
      platformId: "EUW1",
      gameCreation: 1788703200000,
      gameStartTimestamp: 1788703200000,
      gameDuration: 1835,
      gameVersion: "16.17.1",
      queueId: 420,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      mapId: 11,
      participants: [
        {
          champLevel: 18,
          kills: 4,
          deaths: 2,
          assists: 6,
          participantId: 1,
          puuid: "P1",
          teamId: 100,
          championId: 103,
          championName: "Ahri",
          riotIdGameName: "Example",
          win: true,
        },
      ],
    },
  });
  insertMatch(db, fixture);
  const app = createApp(db);
  for (const path of [
    "/",
    "/players",
    "/players/P1",
    "/matches",
    "/matches/EUW1_seo",
    "/matches/EUW1_seo?tab=champions",
    "/leaderboards",
    "/streaks",
    "/heatmaps",
    "/compare",
    "/daily",
    "/about",
  ]) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<html lang="en"/);
    const ld = parseLd(html);
    assert.equal(ld["@context"], "https://schema.org");
    assert.equal(ld["@graph"][1].url, base + path.split("?")[0], path);
    assert.equal(
      ld["@graph"][1].description,
      html
        .match(/<meta name="description" content="([^"]*)"/)![1]!
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    );
    assert.ok(!html.includes(scriptName));
    assert.match(
      html,
      /<meta property="og:image" content="https:\/\/tracker.example\/static\/og.png"/,
    );
    assert.match(html, /<meta name="twitter:image:alt"/);
    assert.match(html, /max-image-preview:large/);
    assert.match(html, /href="\/about"/);
  }
  const matchHtml = await (await app.request("/matches/EUW1_seo")).text();
  assert.match(matchHtml, /Ranked Solo/);
  assert.match(matchHtml, /30:35/);
  assert.match(matchHtml, /Ahri/);
  assert.equal(parseLd(matchHtml)["@graph"][2]["@type"], "BreadcrumbList");
  const filtered = await (await app.request("/?queue=ranked")).text();
  assert.match(filtered, /name="robots" content="noindex,follow"/);
  assert.match(filtered, /rel="canonical" href="https:\/\/tracker.example\/"/);
  for (const path of [
    "/fragments/match/EUW1_seo",
    "/api/v1/players",
    "/not-found",
    "/matches/missing",
    "/matches?page=0",
    "/matches?page=2",
    "/sitemaps/matches-0.xml",
    "/sitemaps/matches-2.xml",
  ]) {
    const response = await app.request(path);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex,follow", path);
    if (!path.startsWith("/fragments/") && !path.startsWith("/api/"))
      assert.equal(response.status, 404, path);
  }
  const sitemap = await (await app.request("/sitemap.xml")).text();
  assert.match(sitemap, /<sitemapindex /);
  assert.match(sitemap, /\/sitemaps\/matches-1.xml/);
  assert.match(
    await (await app.request("/sitemaps/pages.xml")).text(),
    /\/players\/P1/,
  );
  assert.match(
    await (await app.request("/sitemaps/matches-1.xml")).text(),
    /\/matches\/EUW1_seo/,
  );
  assert.match(
    await (await app.request("/robots.txt")).text(),
    /Sitemap: https:\/\/tracker.example\/sitemap.xml/,
  );
  assert.match(
    await (await app.request("/llms.txt")).text(),
    /https:\/\/tracker.example\/API.md/,
  );
  // Cross the sitemap and archive boundaries without loading raw payloads in discovery queries.
  const insert = db.$client.prepare(
    "INSERT INTO matches SELECT ?, game_creation, game_start, game_end, game_duration, game_mode, game_type, queue_id, game_version, map_id, platform_id, raw_json, fetched_at FROM matches WHERE match_id = 'EUW1_seo'",
  );
  db.$client.transaction(() => {
    for (let i = 0; i < 1000; i++)
      insert.run(`EUW1_${String(i).padStart(4, "0")}`);
  })();
  const sitemap2 = await (await app.request("/sitemaps/matches-2.xml")).text();
  assert.equal((sitemap2.match(/<url>/g) ?? []).length, 1);
  assert.equal(
    (await (await app.request("/sitemaps/matches-1.xml")).text()).match(
      /<url>/g,
    )!.length,
    1000,
  );
  assert.match(
    await (await app.request("/sitemap.xml")).text(),
    /matches-2.xml/,
  );
  const page2 = await (await app.request("/matches?page=2")).text();
  assert.match(
    page2,
    /rel="canonical" href="https:\/\/tracker.example\/matches\?page=2"/,
  );
  assert.equal((page2.match(/href="\/matches\/EUW1_/g) ?? []).length, 50);
  assert.match(page2, /rel="next"/);
  const png = readFileSync(new URL("../public/og.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  for (const [name, size] of [
    ["favicon-32", 32],
    ["apple-touch-icon", 180],
    ["icon-192", 192],
    ["icon-512", 512],
  ] as const) {
    const icon = readFileSync(
      new URL(`../public/${name}.png`, import.meta.url),
    );
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
  console.log(
    "SEO smoke passed: metadata, JSON-LD escaping, canonical URLs, crawler controls, archive and sitemap pagination, social image and icons.",
  );
} finally {
  if (oldOrigin === undefined) delete process.env.LOL_TRACKER_PUBLIC_URL;
  else process.env.LOL_TRACKER_PUBLIC_URL = oldOrigin;
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
}
