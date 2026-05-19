import { serve } from "@hono/node-server";
import { defineCommand } from "citty";
import pc from "picocolors";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { pollAll } from "../ingest/poll.js";
import { checkKeyFingerprint } from "../lib/key-check.js";
import { RiotClient } from "../riot/client.js";
import { createApp } from "../web/server.js";

export const serveCmd = defineCommand({
  meta: {
    name: "serve",
    description:
      "Run the web UI and poll Riot on a recurring schedule. Designed for containerized homelab deployments.",
  },
  args: {
    port: {
      type: "string",
      description: "HTTP port",
      default: process.env.PORT ?? "5173",
    },
    "poll-interval": {
      type: "string",
      description:
        "Seconds between polls. Env: POLL_INTERVAL_SECONDS. Set to 0 to disable.",
      default: process.env.POLL_INTERVAL_SECONDS ?? "600",
    },
    "backfill-days": {
      type: "string",
      description: "Days of history to fetch for newly added players",
      default: process.env.BACKFILL_DAYS ?? "7",
    },
    "skip-initial-poll": {
      type: "boolean",
      description: "Don't run a poll immediately on startup",
      default: false,
    },
    verbose: { type: "boolean", description: "Verbose Riot client logging", default: false },
  },
  async run({ args }) {
    const env = loadEnv();
    const db = openDb(env.LOL_TRACKER_DB);
    const keyCheck = checkKeyFingerprint(db, env.RIOT_API_KEY);
    const client = new RiotClient({ apiKey: env.RIOT_API_KEY, verbose: args.verbose });

    const port = Number(args.port);
    const intervalSeconds = Number(args["poll-interval"]);
    const backfillDays = Number(args["backfill-days"]);

    if (keyCheck.kind === "mismatch") {
      console.error(
        pc.red(
          `✗ Riot API key fingerprint changed (${keyCheck.oldFingerprint} → ${keyCheck.newFingerprint}).`,
        ),
      );
      console.error(
        pc.yellow(
          "  auto-poll disabled until 'lol-tracker rekey' is run; web UI still serves cached data.",
        ),
      );
    }

    let polling = false;
    const runPoll = async (label: string) => {
      if (polling) {
        console.log(pc.dim(`[poll:${label}] skipped (previous run still in flight)`));
        return;
      }
      polling = true;
      const t0 = Date.now();
      try {
        const results = await pollAll(db, client, {
          defaultBackfillDays: backfillDays,
          pageSize: 100,
          fetchTimelines: true,
          fetchRank: true,
          fetchMastery: true,
          masteryStaleMs: 24 * 3_600_000,
        });
        const newMatches = results.reduce((s, r) => s + r.newMatches, 0);
        const tl = results.reduce((s, r) => s + r.timelines, 0);
        const errs = results.filter((r) => r.error).length;
        console.log(
          pc.dim(
            `[poll:${label}] ${((Date.now() - t0) / 1000).toFixed(1)}s — ${newMatches} matches, ${tl} timelines, ${results.length} players${errs ? `, ${errs} errored` : ""}`,
          ),
        );
      } catch (e) {
        console.error(pc.red(`[poll:${label}] failed:`), e);
      } finally {
        polling = false;
      }
    };

    let pollTimer: NodeJS.Timeout | undefined;
    if (intervalSeconds > 0 && keyCheck.kind === "ok") {
      if (!args["skip-initial-poll"]) {
        void runPoll("startup");
      }
      pollTimer = setInterval(
        () => void runPoll("interval"),
        intervalSeconds * 1000,
      );
      console.log(pc.dim(`auto-poll every ${intervalSeconds}s`));
    } else if (intervalSeconds === 0) {
      console.log(pc.dim("auto-poll disabled (poll-interval=0)"));
    }

    const app = createApp(db);
    const server = serve({ fetch: app.fetch, port }, ({ port: p }) => {
      console.log(pc.green(`lol-tracker web · http://0.0.0.0:${p}`));
    });

    const shutdown = (signal: string) => {
      console.log(pc.dim(`\n${signal} — shutting down`));
      if (pollTimer) clearInterval(pollTimer);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  },
});
