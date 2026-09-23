import { serve } from "@hono/node-server";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { createApp } from "./server.js";
import { refreshDdragonVersions } from "./lib/ddragon.js";

const env = loadEnv();
const db = openDb(env.LOL_TRACKER_DB);
const app = createApp(db);
const port = Number(process.env.PORT ?? 5173);

await refreshDdragonVersions();
setInterval(() => void refreshDdragonVersions(), 60 * 60 * 1_000).unref();

serve({ fetch: app.fetch, port }, ({ port: p }) => {
  console.log(`lol-tracker web · http://localhost:${p}`);
});
