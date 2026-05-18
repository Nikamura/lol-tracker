import type { Platform, Region } from "../config.js";
import type { RiotClient } from "./client.js";
import {
  ChampionMasteries,
  ChampionMastery,
  LeagueEntries,
  LeagueEntry,
  Match,
  MatchIdList,
  MatchTimeline,
  RiotAccount,
} from "./types.js";

const regionHost = (r: Region) => `${r}.api.riotgames.com`;
const platformHost = (p: Platform) => `${p}.api.riotgames.com`;

export function getAccountByRiotId(
  client: RiotClient,
  region: Region,
  gameName: string,
  tagLine: string,
): Promise<RiotAccount> {
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return client.get(regionHost(region), path, RiotAccount);
}

export function getMatchIdsByPuuid(
  client: RiotClient,
  region: Region,
  puuid: string,
  opts: { startTime?: number; start?: number; count?: number; queue?: number } = {},
): Promise<string[]> {
  const params = new URLSearchParams();
  if (opts.startTime !== undefined) params.set("startTime", String(opts.startTime));
  params.set("start", String(opts.start ?? 0));
  params.set("count", String(opts.count ?? 100));
  if (opts.queue !== undefined) params.set("queue", String(opts.queue));
  const path = `/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`;
  return client.get(regionHost(region), path, MatchIdList);
}

export function getMatch(client: RiotClient, region: Region, matchId: string): Promise<Match> {
  return client.get(regionHost(region), `/lol/match/v5/matches/${matchId}`, Match);
}

export function getMatchTimeline(
  client: RiotClient,
  region: Region,
  matchId: string,
): Promise<MatchTimeline> {
  return client.get(
    regionHost(region),
    `/lol/match/v5/matches/${matchId}/timeline`,
    MatchTimeline,
  );
}

export function getLeagueEntriesByPuuid(
  client: RiotClient,
  platform: Platform,
  puuid: string,
): Promise<LeagueEntry[]> {
  return client.get(
    platformHost(platform),
    `/lol/league/v4/entries/by-puuid/${puuid}`,
    LeagueEntries,
  );
}

export function getChampionMasteriesByPuuid(
  client: RiotClient,
  platform: Platform,
  puuid: string,
): Promise<ChampionMastery[]> {
  return client.get(
    platformHost(platform),
    `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`,
    ChampionMasteries,
  );
}
