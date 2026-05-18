import { defineCommand } from "citty";
import Table from "cli-table3";
import pc from "picocolors";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { getIngestState, listPlayers } from "../db/queries.js";

export const listCmd = defineCommand({
  meta: { name: "list", description: "List tracked players." },
  run() {
    const env = loadEnv();
    const db = openDb(env.LOL_TRACKER_DB);
    const players = listPlayers(db);
    if (players.length === 0) {
      console.log(
        pc.dim("No players tracked yet. Use 'lol-tracker add <riotId> --platform <p>'."),
      );
      return;
    }
    const table = new Table({
      head: ["Name", "Riot ID", "Platform", "Last polled"].map((h) => pc.bold(h)),
      style: { head: [], border: [] },
    });
    for (const p of players) {
      const s = getIngestState(db, p.puuid);
      table.push([
        p.displayName ?? "—",
        `${p.gameName}#${p.tagLine}`,
        p.platform,
        s?.lastPolledAt ? new Date(s.lastPolledAt).toISOString() : pc.dim("never"),
      ]);
    }
    console.log(table.toString());
  },
});
