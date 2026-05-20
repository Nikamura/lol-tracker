import { defineCommand } from "citty";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { runMcpServerOverStdio } from "../mcp/server.js";

export const mcpCmd = defineCommand({
  meta: {
    name: "mcp",
    description:
      "Run an MCP server over stdio that exposes tracked-player data (timeline, match detail, profiles, leaderboards, read-only SQL).",
  },
  async run() {
    const env = loadEnv();
    const db = openDb(env.LOL_TRACKER_DB);
    await runMcpServerOverStdio(db);
    await new Promise<void>((resolve) => {
      process.stdin.on("close", () => resolve());
      process.on("SIGINT", () => resolve());
      process.on("SIGTERM", () => resolve());
    });
  },
});
