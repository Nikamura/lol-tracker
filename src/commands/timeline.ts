import { defineCommand } from "citty";
import Table from "cli-table3";
import pc from "picocolors";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import {
  listPlayers,
  queryTimeline,
  type TimelineFilter,
  type TimelineRow,
} from "../db/queries.js";

const QUEUE_NAMES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  700: "Clash",
  720: "ARAM Clash",
  830: "Co-op vs AI Intro",
  840: "Co-op vs AI Beginner",
  850: "Co-op vs AI Intermediate",
  900: "URF",
  1700: "Arena",
  1900: "URF",
};

const QUEUE_GROUPS: Record<string, number[]> = {
  ranked: [420, 440],
  soloq: [420],
  flex: [440],
  normal: [400, 430, 490],
  aram: [450],
  arena: [1700],
};

function parseSince(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const m = /^(\d+)([dhm])$/.exec(input);
  if (!m) throw new Error(`--since must look like '7d', '12h', or '30m'. Got: ${input}`);
  const n = Number(m[1]);
  const unit = m[2] as "d" | "h" | "m";
  const ms = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return Date.now() - n * ms;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const date = sameDay
    ? "today"
    : d.toLocaleDateString("en-CA", { month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function renderTimeline(rows: TimelineRow[]): string {
  const table = new Table({
    head: ["When", "Player", "Queue", "Champion", "Role", "KDA", "Dur", "W/L"].map((h) =>
      pc.bold(h),
    ),
    style: { head: [], border: [] },
  });

  for (const r of rows) {
    const kda = `${r.kills}/${r.deaths}/${r.assists}`;
    const win = r.win ? pc.green("W") : pc.red("L");
    const name = r.displayName ?? r.gameName;
    const queue = QUEUE_NAMES[r.queueId] ?? r.gameMode;
    table.push([
      fmtWhen(r.gameStart),
      name,
      queue,
      r.championName,
      r.teamPosition ?? "",
      kda,
      fmtDuration(r.gameDuration),
      win,
    ]);
  }
  return table.toString();
}

export const timelineCmd = defineCommand({
  meta: { name: "timeline", description: "Show recent matches across all tracked players." },
  args: {
    since: {
      type: "string",
      description: "Only matches newer than this (e.g. 7d, 12h, 30m)",
      required: false,
    },
    player: {
      type: "string",
      description: "Filter by display name or gameName (substring match)",
      required: false,
    },
    queue: {
      type: "string",
      description: `Filter by queue: ${Object.keys(QUEUE_GROUPS).join(", ")} or a numeric queue id`,
      required: false,
    },
    limit: { type: "string", description: "Max rows", default: "100" },
  },
  run({ args }) {
    const env = loadEnv();
    const db = openDb(env.LOL_TRACKER_DB);
    const sinceMs = parseSince(args.since);

    let puuids: string[] | undefined;
    if (args.player) {
      const all = listPlayers(db);
      const needle = args.player.toLowerCase();
      const matched = all.filter(
        (p) =>
          (p.displayName?.toLowerCase().includes(needle) ?? false) ||
          p.gameName.toLowerCase().includes(needle),
      );
      if (matched.length === 0) throw new Error(`No tracked player matches '${args.player}'`);
      puuids = matched.map((p) => p.puuid);
    }

    let queueIds: number[] | undefined;
    if (args.queue) {
      const key = args.queue.toLowerCase();
      const group = QUEUE_GROUPS[key];
      if (group) {
        queueIds = group;
      } else {
        const n = Number(args.queue);
        if (!Number.isFinite(n)) throw new Error(`Unknown queue filter: ${args.queue}`);
        queueIds = [n];
      }
    }

    const filter: TimelineFilter = { limit: Number(args.limit) };
    if (sinceMs !== undefined) filter.sinceMs = sinceMs;
    if (puuids) filter.puuids = puuids;
    if (queueIds) filter.queueIds = queueIds;
    const rows = queryTimeline(db, filter);
    if (rows.length === 0) {
      console.log(pc.dim("No matches found. Run 'lol-tracker poll' first."));
      return;
    }
    console.log(renderTimeline(rows));
  },
});
