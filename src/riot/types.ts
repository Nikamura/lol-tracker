import { z } from "zod";

/**
 * Riot's responses evolve — we use `.passthrough()` so newly introduced fields
 * don't break ingestion, and so anything not pulled into the typed surface
 * still round-trips through `rawJson`.
 */

export const RiotAccount = z
  .object({
    puuid: z.string(),
    gameName: z.string(),
    tagLine: z.string(),
  })
  .passthrough();
export type RiotAccount = z.infer<typeof RiotAccount>;

export const PerkStats = z
  .object({ defense: z.number(), flex: z.number(), offense: z.number() })
  .passthrough();
export type PerkStats = z.infer<typeof PerkStats>;

export const PerkStyleSelection = z
  .object({
    perk: z.number(),
    var1: z.number(),
    var2: z.number(),
    var3: z.number(),
  })
  .passthrough();
export type PerkStyleSelection = z.infer<typeof PerkStyleSelection>;

export const PerkStyle = z
  .object({
    description: z.string(),
    style: z.number(),
    selections: z.array(PerkStyleSelection),
  })
  .passthrough();
export type PerkStyle = z.infer<typeof PerkStyle>;

export const Perks = z.object({ statPerks: PerkStats, styles: z.array(PerkStyle) }).passthrough();
export type Perks = z.infer<typeof Perks>;

export const MatchParticipant = z
  .object({
    puuid: z.string(),
    participantId: z.number().optional(),
    championId: z.number(),
    championName: z.string(),
    championTransform: z.number().optional(),
    champLevel: z.number(),
    champExperience: z.number().optional(),
    teamId: z.number(),
    teamPosition: z.string().optional(),
    individualPosition: z.string().optional(),
    lane: z.string().optional(),
    role: z.string().optional(),
    win: z.boolean(),
    kills: z.number(),
    deaths: z.number(),
    assists: z.number(),
    goldEarned: z.number().optional(),
    goldSpent: z.number().optional(),
    totalMinionsKilled: z.number().optional(),
    neutralMinionsKilled: z.number().optional(),
    visionScore: z.number().optional(),
    wardsPlaced: z.number().optional(),
    wardsKilled: z.number().optional(),
    detectorWardsPlaced: z.number().optional(),
    visionWardsBoughtInGame: z.number().optional(),
    totalDamageDealt: z.number().optional(),
    physicalDamageDealt: z.number().optional(),
    magicDamageDealt: z.number().optional(),
    trueDamageDealt: z.number().optional(),
    totalDamageDealtToChampions: z.number().optional(),
    physicalDamageDealtToChampions: z.number().optional(),
    magicDamageDealtToChampions: z.number().optional(),
    trueDamageDealtToChampions: z.number().optional(),
    largestCriticalStrike: z.number().optional(),
    totalDamageTaken: z.number().optional(),
    physicalDamageTaken: z.number().optional(),
    magicDamageTaken: z.number().optional(),
    trueDamageTaken: z.number().optional(),
    damageSelfMitigated: z.number().optional(),
    totalHeal: z.number().optional(),
    totalHealsOnTeammates: z.number().optional(),
    totalDamageShieldedOnTeammates: z.number().optional(),
    damageDealtToObjectives: z.number().optional(),
    damageDealtToTurrets: z.number().optional(),
    damageDealtToBuildings: z.number().optional(),
    timeCCingOthers: z.number().optional(),
    totalTimeCCDealt: z.number().optional(),
    totalTimeSpentDead: z.number().optional(),
    longestTimeSpentLiving: z.number().optional(),
    largestKillingSpree: z.number().optional(),
    largestMultiKill: z.number().optional(),
    killingSprees: z.number().optional(),
    doubleKills: z.number().optional(),
    tripleKills: z.number().optional(),
    quadraKills: z.number().optional(),
    pentaKills: z.number().optional(),
    firstBloodKill: z.boolean().optional(),
    firstBloodAssist: z.boolean().optional(),
    firstTowerKill: z.boolean().optional(),
    firstTowerAssist: z.boolean().optional(),
    turretKills: z.number().optional(),
    turretTakedowns: z.number().optional(),
    inhibitorKills: z.number().optional(),
    inhibitorTakedowns: z.number().optional(),
    dragonKills: z.number().optional(),
    baronKills: z.number().optional(),
    objectivesStolen: z.number().optional(),
    objectivesStolenAssists: z.number().optional(),
    gameEndedInSurrender: z.boolean().optional(),
    gameEndedInEarlySurrender: z.boolean().optional(),
    teamEarlySurrendered: z.boolean().optional(),
    summoner1Id: z.number().optional(),
    summoner2Id: z.number().optional(),
    summoner1Casts: z.number().optional(),
    summoner2Casts: z.number().optional(),
    item0: z.number().optional(),
    item1: z.number().optional(),
    item2: z.number().optional(),
    item3: z.number().optional(),
    item4: z.number().optional(),
    item5: z.number().optional(),
    item6: z.number().optional(),
    perks: Perks.optional(),
    // Riot's challenges payload is loosely typed: most fields are numbers,
    // some are booleans, and a handful are arrays (e.g. legendaryItemUsed).
    // We don't introspect individual challenge keys in queries — we just
    // store the blob — so don't constrain the value type.
    challenges: z.record(z.string(), z.unknown()).optional(),
    riotIdGameName: z.string().optional(),
    riotIdTagline: z.string().optional(),
    summonerName: z.string().optional(),
    summonerLevel: z.number().optional(),
  })
  .passthrough();
export type MatchParticipant = z.infer<typeof MatchParticipant>;

export const MatchMetadata = z
  .object({
    dataVersion: z.string(),
    matchId: z.string(),
    participants: z.array(z.string()),
  })
  .passthrough();
export type MatchMetadata = z.infer<typeof MatchMetadata>;

export const MatchTeam = z
  .object({
    teamId: z.number(),
    win: z.boolean(),
    bans: z.array(z.object({ championId: z.number(), pickTurn: z.number() }).passthrough()),
    objectives: z.record(
      z.string(),
      z.object({ first: z.boolean(), kills: z.number() }).passthrough(),
    ),
  })
  .passthrough();
export type MatchTeam = z.infer<typeof MatchTeam>;

export const MatchInfo = z
  .object({
    gameCreation: z.number(),
    gameStartTimestamp: z.number(),
    gameEndTimestamp: z.number().optional(),
    gameDuration: z.number(),
    gameMode: z.string(),
    gameType: z.string(),
    queueId: z.number(),
    gameVersion: z.string(),
    mapId: z.number(),
    platformId: z.string(),
    participants: z.array(MatchParticipant),
    teams: z.array(MatchTeam).optional(),
  })
  .passthrough();
export type MatchInfo = z.infer<typeof MatchInfo>;

export const Match = z.object({ metadata: MatchMetadata, info: MatchInfo }).passthrough();
export type Match = z.infer<typeof Match>;

export const MatchTimeline = z
  .object({
    metadata: MatchMetadata,
    info: z
      .object({
        frameInterval: z.number(),
        gameId: z.number().optional(),
        participants: z
          .array(z.object({ participantId: z.number(), puuid: z.string() }).passthrough())
          .optional(),
        frames: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();
export type MatchTimeline = z.infer<typeof MatchTimeline>;

export const LeagueEntry = z
  .object({
    leagueId: z.string().optional(),
    puuid: z.string().optional(),
    queueType: z.string(),
    tier: z.string().optional(),
    rank: z.string().optional(),
    leaguePoints: z.number().optional(),
    wins: z.number(),
    losses: z.number(),
    hotStreak: z.boolean().optional(),
    veteran: z.boolean().optional(),
    freshBlood: z.boolean().optional(),
    inactive: z.boolean().optional(),
  })
  .passthrough();
export type LeagueEntry = z.infer<typeof LeagueEntry>;

export const LeagueEntries = z.array(LeagueEntry);

export const ChampionMastery = z
  .object({
    puuid: z.string(),
    championId: z.number(),
    championPoints: z.number(),
    championLevel: z.number(),
    lastPlayTime: z.number().optional(),
    chestGranted: z.boolean().optional(),
    tokensEarned: z.number().optional(),
  })
  .passthrough();
export type ChampionMastery = z.infer<typeof ChampionMastery>;

export const ChampionMasteries = z.array(ChampionMastery);

export const MatchIdList = z.array(z.string());
