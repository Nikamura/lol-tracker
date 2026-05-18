export interface PageSeo {
  title: string;
  description: string;
  /** Path-only canonical (e.g. "/leaderboards"). Combined with the site base URL at render time. */
  path: string;
  /** Optional override for og:image path. Defaults to the site OG image. */
  image?: string;
  /** Set true for pages that should not be indexed (HTMX fragments, filtered views, etc.). */
  noindex?: boolean;
}

const SITE_NAME = "lol-tracker";
const DEFAULT_TITLE = "lol-tracker — friend-group LoL match archive";
const DEFAULT_DESCRIPTION =
  "Tournament-style match archive for a friend group's League of Legends games — timelines, leaderboards, streaks, and play-time heatmaps.";
const DEFAULT_OG_IMAGE = "/static/og.svg";

const TWITTER_HANDLE = ""; // optional; left blank intentionally

export interface ResolvedSeo {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  siteName: string;
  twitterHandle: string;
  noindex: boolean;
}

export function resolveSeo(seo: PageSeo | undefined, baseUrl: string): ResolvedSeo {
  const title = seo?.title ?? DEFAULT_TITLE;
  const description = seo?.description ?? DEFAULT_DESCRIPTION;
  const path = seo?.path ?? "/";
  const imagePath = seo?.image ?? DEFAULT_OG_IMAGE;
  return {
    title,
    description,
    canonical: joinUrl(baseUrl, path),
    ogImage: joinUrl(baseUrl, imagePath),
    siteName: SITE_NAME,
    twitterHandle: TWITTER_HANDLE,
    noindex: seo?.noindex ?? false,
  };
}

export function resolveBaseUrl(reqUrl: string): string {
  const env = process.env.LOL_TRACKER_PUBLIC_URL?.trim();
  if (env) return stripTrailingSlash(env);
  try {
    const u = new URL(reqUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export const defaultSeo = (): PageSeo => ({
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  path: "/",
});
