import { defineCommand } from "citty";
import pc from "picocolors";
import { isPlatform, loadEnv, PLATFORM_TO_REGION, regionFor } from "../config.js";
import { openDb } from "../db/connect.js";
import { upsertPlayer } from "../db/queries.js";
import { RiotClient } from "../riot/client.js";
import { getAccountByRiotId } from "../riot/endpoints.js";

export const addCmd = defineCommand({
  meta: { name: "add", description: "Track a player by Riot ID (gameName#tagLine)." },
  args: {
    riotId: {
      type: "positional",
      description: "Riot ID in 'gameName#tagLine' form",
      required: true,
    },
    platform: {
      type: "string",
      description: "Platform routing value (euw1, na1, kr, ...)",
      required: true,
    },
    name: { type: "string", description: "Friendly display name", required: false },
  },
  async run({ args }) {
    const env = loadEnv();
    const platform = args.platform.toLowerCase();
    if (!isPlatform(platform)) {
      throw new Error(
        `Unknown platform '${args.platform}'. Expected one of: ${Object.keys(PLATFORM_TO_REGION).join(", ")}`,
      );
    }
    const region = regionFor(platform);
    const [gameName, tagLine] = args.riotId.split("#");
    if (!gameName || !tagLine) {
      throw new Error(`Riot ID must be in 'gameName#tagLine' form. Got: ${args.riotId}`);
    }

    const client = new RiotClient({ apiKey: env.RIOT_API_KEY });
    const account = await getAccountByRiotId(client, region, gameName, tagLine);

    const db = openDb(env.LOL_TRACKER_DB);
    upsertPlayer(db, {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      platform,
      region,
      displayName: args.name ?? null,
    });

    const label = args.name
      ? `${args.name} (${account.gameName}#${account.tagLine})`
      : `${account.gameName}#${account.tagLine}`;
    console.log(pc.green(`✓ tracking ${label} [${platform}/${region}]`));
    console.log(pc.dim(`  puuid: ${account.puuid}`));
    console.log(pc.dim(`  run 'lol-tracker poll' to fetch matches`));
  },
});
