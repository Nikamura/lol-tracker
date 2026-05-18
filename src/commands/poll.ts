import { defineCommand } from "citty";
import pc from "picocolors";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { pollAll } from "../ingest/poll.js";
import { RiotClient } from "../riot/client.js";

export const pollCmd = defineCommand({
  meta: { name: "poll", description: "Fetch new matches, timelines, rank, and mastery." },
  args: {
    "backfill-days": {
      type: "string",
      description: "Days of history to fetch for newly added players",
      default: "7",
    },
    "skip-timelines": {
      type: "boolean",
      description: "Skip the Match-V5 timeline endpoint (halves API cost per match)",
      default: false,
    },
    "skip-rank": {
      type: "boolean",
      description: "Skip the League-V4 rank snapshot",
      default: false,
    },
    "skip-mastery": {
      type: "boolean",
      description: "Skip Champion-Mastery refresh",
      default: false,
    },
    "mastery-stale-hours": {
      type: "string",
      description: "Only refresh mastery if last fetched more than this many hours ago",
      default: "24",
    },
    verbose: { type: "boolean", description: "Log every API call", default: false },
  },
  async run({ args }) {
    const env = loadEnv();
    const client = new RiotClient({ apiKey: env.RIOT_API_KEY, verbose: args.verbose });
    const db = openDb(env.LOL_TRACKER_DB);
    const t0 = Date.now();
    const results = await pollAll(db, client, {
      defaultBackfillDays: Number(args["backfill-days"]),
      pageSize: 100,
      fetchTimelines: !args["skip-timelines"],
      fetchRank: !args["skip-rank"],
      fetchMastery: !args["skip-mastery"],
      masteryStaleMs: Number(args["mastery-stale-hours"]) * 3_600_000,
    });
    const totalNew = results.reduce((s, r) => s + r.newMatches, 0);
    const totalTl = results.reduce((s, r) => s + r.timelines, 0);
    const errs = results.filter((r) => r.error).length;
    console.log(
      pc.bold(
        `done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalNew} matches, ${totalTl} timelines across ${results.length} players${errs ? `, ${errs} errored` : ""}`,
      ),
    );
  },
});
