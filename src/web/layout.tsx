import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title?: string; active?: string }>> = ({
  title = "lol-tracker",
  active,
  children,
}) => (
  <html lang="en" class="dark">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/static/app.css" />
      <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
    </head>
    <body class="min-h-screen bg-background text-foreground">
      <header class="border-b">
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <a href="/" class="text-sm font-semibold tracking-tight">
            lol-tracker
          </a>
          <nav class="flex items-center gap-1 text-sm">
            <NavLink href="/" label="Timeline" active={active === "timeline"} />
            <NavLink href="/players" label="Players" active={active === "players"} />
          </nav>
        </div>
      </header>
      <main class="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </body>
  </html>
);

const NavLink: FC<{ href: string; label: string; active: boolean }> = ({
  href,
  label,
  active,
}) => (
  <a
    href={href}
    class={
      "rounded-md px-3 py-1.5 transition-colors " +
      (active
        ? "bg-secondary text-secondary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
    }
  >
    {label}
  </a>
);
