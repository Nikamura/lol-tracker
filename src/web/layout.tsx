import type { FC, PropsWithChildren } from "hono/jsx";
import type { ResolvedSeo } from "./seo.js";

export const Layout: FC<PropsWithChildren<{ active?: string; seo: ResolvedSeo }>> = ({
  active,
  seo,
  children,
}) => (
  <html lang="en" class="dark">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      {seo.canonical ? <link rel="canonical" href={seo.canonical} /> : null}
      <meta
        name="robots"
        content={seo.noindex ? "noindex,nofollow" : "index,follow"}
      />
      <meta name="theme-color" content="#0a0f1f" media="(prefers-color-scheme: dark)" />
      <meta name="theme-color" content="#fafaf6" media="(prefers-color-scheme: light)" />
      <meta name="color-scheme" content="dark light" />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={seo.siteName} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      {seo.canonical ? <meta property="og:url" content={seo.canonical} /> : null}
      <meta property="og:image" content={seo.ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${seo.siteName} — ${seo.description}`} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      <meta name="twitter:image" content={seo.ogImage} />
      {seo.twitterHandle ? <meta name="twitter:site" content={seo.twitterHandle} /> : null}

      <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
      <link rel="alternate icon" href="/static/favicon.svg" />
      <link rel="apple-touch-icon" href="/static/favicon.svg" />

      <link rel="stylesheet" href="/static/app.css" />
      <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
      {/* 100% privacy-first analytics */}
      <script data-collect-dnt="true" async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
      <noscript>
        <img
          src="https://queue.simpleanalyticscdn.com/noscript.gif?collect-dnt=true"
          alt=""
          referrerpolicy="no-referrer-when-downgrade"
        />
      </noscript>
    </head>
    <body class="min-h-screen bg-background text-foreground">
      <Masthead active={active} />
      <main class="mx-auto max-w-6xl px-6 pb-16">{children}</main>
      <Footer />
    </body>
  </html>
);

const Masthead: FC<{ active?: string | undefined }> = ({ active }) => (
  <header class="relative border-b border-border/70">
    <div class="mx-auto max-w-6xl px-6">
      {/* eyebrow strip */}
      <div class="scoreboard-eyebrow flex items-center justify-between border-b border-border/40 py-2">
        <div class="flex items-center gap-2">
          <span class="size-1.5 rounded-full bg-success pulse-dot" aria-hidden="true" />
          <span>Live feed</span>
          <span class="text-foreground/30">/</span>
          <span class="text-foreground/60">Friend group ranked tracker</span>
        </div>
        <div class="hidden md:flex items-center gap-3">
          <span class="text-foreground/40">v0.1</span>
          <span class="text-foreground/30">/</span>
          <span class="text-foreground/60">EU-WEST · KR · NA</span>
        </div>
      </div>

      {/* Masthead title row */}
      <div class="flex items-end justify-between gap-6 py-5">
        <a href="/" class="group inline-flex flex-col gap-1">
          <span class="font-display text-foreground text-5xl leading-none tracking-tight md:text-6xl">
            LOL <span class="text-success">/</span> TRACKER
          </span>
          <span class="scoreboard-eyebrow text-foreground/45">
            Match&nbsp;archive&nbsp;·&nbsp;Tactical&nbsp;readout
          </span>
        </a>
        <div class="hidden md:flex items-end gap-4 text-right">
          <ClockChip />
        </div>
      </div>

      {/* Navigation row */}
      <nav class="flex items-stretch gap-px overflow-x-auto border-t border-border/40">
        <NavLink href="/" label="Timeline" active={active === "timeline"} />
        <NavLink href="/leaderboards" label="Leaderboards" active={active === "leaderboards"} />
        <NavLink href="/streaks" label="Streaks" active={active === "streaks"} />
        <NavLink href="/heatmaps" label="Heatmaps" active={active === "heatmaps"} />
        <NavLink href="/compare" label="Comparisons" active={active === "compare"} />
        <NavLink href="/players" label="Players" active={active === "players"} />
      </nav>
    </div>
  </header>
);

const NavLink: FC<{ href: string; label: string; active: boolean }> = ({
  href,
  label,
  active,
}) => (
  <a
    href={href}
    class={
      "kicker relative px-4 py-3 text-sm tracking-[0.18em] transition-colors " +
      (active
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground")
    }
  >
    {active && (
      <span
        class="bg-success absolute inset-x-3 -top-px h-[2px]"
        aria-hidden="true"
      />
    )}
    {label}
  </a>
);

const ClockChip: FC = () => {
  // Server-rendered timestamp — Hono renders once at request time. The "Live"
  // dot animates client-side, so the value need only refresh on navigation.
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return (
    <div class="flex items-center gap-3 text-xs">
      <div class="flex flex-col items-end">
        <span class="font-mono text-foreground text-base leading-none">
          {hh}:{mm}
          <span class="text-muted-foreground"> UTC</span>
        </span>
        <span class="scoreboard-eyebrow mt-1">Server clock</span>
      </div>
    </div>
  );
};

const Footer: FC = () => (
  <footer class="border-t border-border/40 mt-12">
    <div class="mx-auto max-w-6xl px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
      <span class="scoreboard-eyebrow">
        Compiled by lol-tracker · Not endorsed by Riot Games
      </span>
      <span class="font-mono">
        SQLite · Hono · HTMX · Tailwind
      </span>
    </div>
  </footer>
);
