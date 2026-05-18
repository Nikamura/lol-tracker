import { defineCommand } from "citty";
import pc from "picocolors";
import { loadEnv } from "../config.js";
import { openDb } from "../db/connect.js";
import {
  deletePlayer,
  findPlayerByRiotId,
  findPlayersByGameName,
} from "../db/queries.js";

export const removeCmd = defineCommand({
  meta: {
    name: "remove",
    description:
      "Stop tracking a player and delete their unique data (rank snapshots, mastery, ingest cursor).",
  },
  args: {
    name: {
      type: "positional",
      description:
        "Riot ID 'gameName#tagLine', or bare gameName if it is unique among tracked players",
      required: true,
    },
    purgeMatches: {
      type: "boolean",
      description:
        "Also delete matches no other tracked player participated in (cascades match_participants + timelines)",
      default: false,
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    const env = loadEnv();
    const db = openDb(env.LOL_TRACKER_DB);

    const raw = args.name.trim();
    const hashIdx = raw.indexOf("#");
    const player = (() => {
      if (hashIdx >= 0) {
        const gameName = raw.slice(0, hashIdx);
        const tagLine = raw.slice(hashIdx + 1);
        if (!gameName || !tagLine) {
          throw new Error(`Riot ID must be 'gameName#tagLine'. Got: ${raw}`);
        }
        return findPlayerByRiotId(db, gameName, tagLine);
      }
      const matches = findPlayersByGameName(db, raw);
      if (matches.length === 0) return undefined;
      if (matches.length > 1) {
        const list = matches.map((m) => `${m.gameName}#${m.tagLine}`).join(", ");
        throw new Error(
          `Multiple tracked players named '${raw}': ${list}. Pass the full Riot ID.`,
        );
      }
      return matches[0];
    })();

    if (!player) {
      console.error(pc.red(`✗ no tracked player matches '${raw}'`));
      process.exit(1);
    }

    const label = `${player.gameName}#${player.tagLine}${player.displayName ? ` (${player.displayName})` : ""}`;
    if (!args.yes) {
      const confirm = await prompt(
        `${pc.yellow("?")} Remove ${pc.bold(label)} [${player.platform}]${args.purgeMatches ? " and purge orphan matches" : ""}? [y/N] `,
      );
      if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
        console.log(pc.dim("aborted"));
        return;
      }
    }

    const orphans = deletePlayer(db, player.puuid, {
      purgeOrphanMatches: args.purgeMatches,
    });
    console.log(pc.green(`✓ removed ${label}`));
    console.log(
      pc.dim(
        `  cascaded: ingest_state, player_rank_snapshots, player_mastery`,
      ),
    );
    if (args.purgeMatches) {
      console.log(
        pc.dim(`  orphan matches deleted: ${orphans}`),
      );
    } else {
      console.log(
        pc.dim(
          `  match_participants rows kept (other tracked players may share them); pass --purge-matches to remove orphans`,
        ),
      );
    }
  },
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setEncoding("utf-8");
    const onData = (chunk: string) => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      resolve(chunk.trim());
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
