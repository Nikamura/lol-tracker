import { defineCommand } from "citty";
import pc from "picocolors";
import { type Region, loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import { listPlayers } from "../db/queries.js";
import {
  KEY_FINGERPRINT_META,
  getMeta,
  keyFingerprint,
  rekeyPlayerPuuid,
  rewriteRawJsonPuuids,
  setMeta,
} from "../db/rekey.js";
import { RiotClient } from "../riot/client.js";
import { getAccountByRiotId } from "../riot/endpoints.js";

export const rekeyCmd = defineCommand({
  meta: {
    name: "rekey",
    description:
      "Rotate PUUIDs after a Riot API key change. Re-resolves each tracked Riot ID to its new PUUID and updates every table that keys off it.",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print what would change without writing anything",
      default: false,
    },
    "rewrite-json": {
      type: "boolean",
      description:
        "Also rewrite PUUIDs embedded inside matches.raw_json and match_timelines.raw_json (slow but exhaustive)",
      default: false,
    },
    verbose: { type: "boolean", description: "Log every Riot API call", default: false },
  },
  async run({ args }) {
    const env = loadEnv();
    const client = new RiotClient({ apiKey: env.RIOT_API_KEY, verbose: args.verbose });
    const db = openDb(env.LOL_TRACKER_DB);

    const newFp = keyFingerprint(env.RIOT_API_KEY);
    const oldFp = getMeta(db, KEY_FINGERPRINT_META);
    if (oldFp && oldFp === newFp) {
      console.log(
        pc.dim(`Key fingerprint unchanged (${newFp}). Nothing to do.`),
      );
      return;
    }

    const playersList = listPlayers(db);
    if (playersList.length === 0) {
      console.log(pc.dim("No players tracked — nothing to rekey."));
      if (!args["dry-run"]) setMeta(db, KEY_FINGERPRINT_META, newFp);
      return;
    }

    console.log(
      pc.bold(
        `Rekeying ${playersList.length} player${playersList.length === 1 ? "" : "s"} against fingerprint ${newFp}${oldFp ? ` (was ${oldFp})` : ""}${args["dry-run"] ? pc.yellow(" — dry run") : ""}`,
      ),
    );

    const mapping = new Map<string, string>();
    let rotated = 0;
    let unchanged = 0;
    let errored = 0;
    for (const p of playersList) {
      const label = `${p.gameName}#${p.tagLine}${p.displayName ? ` (${p.displayName})` : ""}`;
      try {
        const acc = await getAccountByRiotId(
          client,
          p.region as Region,
          p.gameName,
          p.tagLine,
        );
        if (acc.puuid === p.puuid) {
          console.log(pc.dim(`= ${label}: already on current key`));
          unchanged++;
          continue;
        }
        if (args["dry-run"]) {
          console.log(
            pc.yellow(
              `~ ${label}: ${p.puuid.slice(0, 12)}… → ${acc.puuid.slice(0, 12)}…`,
            ),
          );
        } else {
          rekeyPlayerPuuid(db, p.puuid, acc.puuid);
          console.log(
            pc.green(
              `✓ ${label}: ${p.puuid.slice(0, 12)}… → ${acc.puuid.slice(0, 12)}…`,
            ),
          );
        }
        mapping.set(p.puuid, acc.puuid);
        rotated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(pc.red(`✗ ${label}: ${msg}`));
        errored++;
      }
    }

    if (args["rewrite-json"] && mapping.size > 0 && !args["dry-run"]) {
      console.log(pc.dim("rewriting raw_json blobs…"));
      const t0 = Date.now();
      const r = rewriteRawJsonPuuids(db, mapping);
      console.log(
        pc.dim(
          `  updated ${r.matchesUpdated} matches and ${r.timelinesUpdated} timelines in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        ),
      );
    } else if (args["rewrite-json"] && args["dry-run"] && mapping.size > 0) {
      console.log(pc.dim("(dry run) would rewrite raw_json blobs for matches and timelines"));
    }

    if (args["dry-run"]) {
      console.log(
        pc.bold(
          `dry run — ${rotated} would rotate, ${unchanged} already current, ${errored} errored`,
        ),
      );
      return;
    }

    if (errored === 0) {
      setMeta(db, KEY_FINGERPRINT_META, newFp);
      console.log(
        pc.bold(
          `done — ${rotated} rotated, ${unchanged} already current; stored fingerprint ${newFp}`,
        ),
      );
    } else {
      console.log(
        pc.bold(
          pc.yellow(
            `done with errors — ${rotated} rotated, ${unchanged} already current, ${errored} errored; fingerprint NOT updated (re-run rekey after fixing)`,
          ),
        ),
      );
      process.exitCode = 1;
    }
  },
});
