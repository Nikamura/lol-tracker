import type { MatchRaw } from "../db/queries.js";
import { queueLabel } from "../lib/queues.js";

export interface PageSeo {
  title: string;
  description: string;
  /** Canonical path, with pagination only when it changes the document. */
  path: string;
  noindex?: boolean;
  type?: "WebPage" | "CollectionPage" | "AboutPage";
  breadcrumbs?: Array<{ name: string; path: string }>;
}

const SITE_NAME = "lol-tracker";
const DEFAULT_TITLE =
  "LoL match tracker — friend-group stats & champion graphs";
const DEFAULT_DESCRIPTION =
  "Explore a friend group's League of Legends match archive: champion graphs, builds, player profiles, leaderboards, streaks and play-time heatmaps.";
export const ROBOTS_INDEX =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
export const ROBOTS_NOINDEX = "noindex,follow";

export interface ResolvedSeo {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  imageAlt: string;
  siteName: string;
  noindex: boolean;
  breadcrumbs: Array<{ name: string; url: string }>;
  jsonLd: string;
}

export function resolveSeo(
  seo: PageSeo | undefined,
  baseUrl: string,
): ResolvedSeo {
  const title = seo?.title ?? DEFAULT_TITLE;
  const description = seo?.description ?? DEFAULT_DESCRIPTION;
  const canonical = baseUrl + (seo?.path ?? "/");
  const ogImage = baseUrl + "/static/og.png";
  const breadcrumbs = (seo?.breadcrumbs ?? []).map((b) => ({
    name: b.name,
    url: baseUrl + b.path,
  }));
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebSite",
      "@id": baseUrl + "/#website",
      url: baseUrl + "/",
      name: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      inLanguage: "en",
    },
    {
      "@type": seo?.type ?? "WebPage",
      "@id": canonical + "#webpage",
      url: canonical,
      name: title,
      description,
      isPartOf: { "@id": baseUrl + "/#website" },
      inLanguage: "en",
      about: {
        "@type": "VideoGame",
        name: "League of Legends",
        url: "https://www.leagueoflegends.com/",
      },
      image: { "@type": "ImageObject", url: ogImage, width: 1200, height: 630 },
      ...(breadcrumbs.length > 1
        ? { breadcrumb: { "@id": canonical + "#breadcrumb" } }
        : {}),
    },
  ];
  if (breadcrumbs.length > 1)
    graph.push({
      "@type": "BreadcrumbList",
      "@id": canonical + "#breadcrumb",
      itemListElement: breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: b.url,
      })),
    });
  return {
    title,
    description,
    canonical,
    ogImage,
    siteName: SITE_NAME,
    imageAlt:
      "LOL / TRACKER — League of Legends match archive, champion graphs and friend-group stats",
    noindex: seo?.noindex ?? false,
    breadcrumbs,
    // Script text is not HTML-escaped by the renderer. Escape '<' even in player names.
    jsonLd: JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph,
    }).replace(/</g, "\\u003c"),
  };
}

export function resolveBaseUrl(reqUrl: string): string {
  const configured = process.env.LOL_TRACKER_PUBLIC_URL?.trim();
  const url = new URL(configured || reqUrl);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (configured && (url.pathname !== "/" || url.search || url.hash))
  ) {
    throw new Error(
      "LOL_TRACKER_PUBLIC_URL must be an HTTP(S) origin without credentials, path, query or fragment",
    );
  }
  return url.origin;
}

export function matchSeo(raw: MatchRaw): PageSeo {
  const { metadata, info } = raw.match;
  const queue = queueLabel(info.queueId, info.gameMode);
  const day = new Date(info.gameStartTimestamp).toISOString().slice(0, 10);
  const names = info.participants
    .filter((p) => raw.trackedNames.has(p.puuid))
    .slice(0, 3)
    .map((p) => `${raw.trackedNames.get(p.puuid)} (${p.championName})`)
    .join(", ");
  const duration = `${Math.floor(info.gameDuration / 60)}:${String(info.gameDuration % 60).padStart(2, "0")}`;
  const path = `/matches/${encodeURIComponent(metadata.matchId)}`;
  return {
    title: `${queue} · ${day} · ${metadata.matchId} · lol-tracker`,
    description: `${queue} on ${day}, ${duration}. ${names ? names + ". " : ""}Explore results, champion builds, player stats and match graphs.`,
    path,
    breadcrumbs: [
      { name: "Home", path: "/" },
      { name: "Match archive", path: "/matches" },
      { name: metadata.matchId, path },
    ],
  };
}

export const defaultSeo = (): PageSeo => ({
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  path: "/",
});
