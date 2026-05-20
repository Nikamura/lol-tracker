import { defineCommand } from "citty";
import pc from "picocolors";
import { openDb } from "../db/connect.js";
import { runMcpServerOverHttp, runMcpServerOverStdio } from "../mcp/server.js";

const DEFAULT_DB = "./data/lol-tracker.db";

export const mcpCmd = defineCommand({
  meta: {
    name: "mcp",
    description:
      "Run an MCP server that exposes tracked-player data. Defaults to HTTP so it can be hosted and added to AI tools by URL; pass --stdio for desktop clients that spawn a child process.",
  },
  args: {
    stdio: {
      type: "boolean",
      description: "Speak MCP over stdio instead of HTTP.",
      default: false,
    },
    port: {
      type: "string",
      description: "HTTP port (ignored with --stdio). Env: MCP_PORT.",
      default: process.env.MCP_PORT ?? "3333",
    },
    host: {
      type: "string",
      description: "HTTP bind address (ignored with --stdio). Env: MCP_HOST.",
      default: process.env.MCP_HOST ?? "127.0.0.1",
    },
    path: {
      type: "string",
      description: "HTTP path the MCP transport is mounted at.",
      default: "/mcp",
    },
    db: {
      type: "string",
      description: "Override the SQLite path. Env: LOL_TRACKER_DB.",
      default: process.env.LOL_TRACKER_DB ?? DEFAULT_DB,
    },
  },
  async run({ args }) {
    const db = openDb(args.db);

    if (args.stdio) {
      await runMcpServerOverStdio(db);
      await new Promise<void>((resolve) => {
        process.stdin.on("close", () => resolve());
        process.on("SIGINT", () => resolve());
        process.on("SIGTERM", () => resolve());
      });
      return;
    }

    const handle = await runMcpServerOverHttp(db, {
      port: Number(args.port),
      host: args.host,
      path: args.path,
    });
    console.log(pc.green(`lol-tracker mcp · ${handle.url}`));
    console.log(pc.dim(`db: ${args.db}`));

    const shutdown = (signal: string) => {
      console.log(pc.dim(`\n${signal} — shutting down`));
      void handle.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    await new Promise<void>(() => {});
  },
});
