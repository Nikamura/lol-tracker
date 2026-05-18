import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  ChampionMastery,
  LeagueEntry,
  Match,
  MatchTimeline,
  Perks,
} from "../riot/types.js";

/**
 * Players we track. PUUID is Riot's stable account identifier.
 */
export const players = sqliteTable("players", {
  puuid: text("puuid").primaryKey(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  platform: text("platform").notNull(),
  region: text("region").notNull(),
  displayName: text("display_name"),
  addedAt: integer("added_at").notNull(),
});

/**
 * One row per LoL match. `rawJson` holds the full Match-V5 response so v2 stats
 * can mine fields we don't project explicitly.
 */
export const matches = sqliteTable(
  "matches",
  {
    matchId: text("match_id").primaryKey(),
    gameCreation: integer("game_creation").notNull(),
    gameStart: integer("game_start").notNull(),
    gameEnd: integer("game_end"),
    gameDuration: integer("game_duration").notNull(),
    gameMode: text("game_mode").notNull(),
    gameType: text("game_type"),
    queueId: integer("queue_id").notNull(),
    gameVersion: text("game_version").notNull(),
    mapId: integer("map_id").notNull(),
    platformId: text("platform_id").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<Match>().notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [index("idx_matches_start").on(t.gameStart)],
);

/**
 * One row per (match, participant). Every queryable stat from the Match-V5
 * participant object is projected here. Perks and challenges are stored as
 * JSON so we don't blow out the column count further.
 */
export const matchParticipants = sqliteTable(
  "match_participants",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.matchId, { onDelete: "cascade" }),
    puuid: text("puuid").notNull(),
    championId: integer("champion_id").notNull(),
    championName: text("champion_name").notNull(),
    teamId: integer("team_id").notNull(),
    teamPosition: text("team_position"),
    individualPosition: text("individual_position"),
    lane: text("lane"),
    role: text("role"),
    win: integer("win", { mode: "boolean" }).notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    champLevel: integer("champ_level"),
    champExperience: integer("champ_experience"),
    championTransform: integer("champion_transform"),
    goldEarned: integer("gold_earned"),
    goldSpent: integer("gold_spent"),
    totalMinionsKilled: integer("total_minions_killed"),
    neutralMinionsKilled: integer("neutral_minions_killed"),
    visionScore: integer("vision_score"),
    wardsPlaced: integer("wards_placed"),
    wardsKilled: integer("wards_killed"),
    detectorWardsPlaced: integer("detector_wards_placed"),
    visionWardsBought: integer("vision_wards_bought"),
    totalDamageDealt: integer("total_damage_dealt"),
    totalDamageDealtToChampions: integer("total_damage_dealt_to_champions"),
    physicalDamageToChampions: integer("physical_damage_to_champions"),
    magicDamageToChampions: integer("magic_damage_to_champions"),
    trueDamageToChampions: integer("true_damage_to_champions"),
    totalDamageTaken: integer("total_damage_taken"),
    damageSelfMitigated: integer("damage_self_mitigated"),
    totalHeal: integer("total_heal"),
    totalHealsOnTeammates: integer("total_heals_on_teammates"),
    damageDealtToObjectives: integer("damage_dealt_to_objectives"),
    damageDealtToTurrets: integer("damage_dealt_to_turrets"),
    damageDealtToBuildings: integer("damage_dealt_to_buildings"),
    timeCcingOthers: integer("time_ccing_others"),
    totalTimeCcDealt: integer("total_time_cc_dealt"),
    totalTimeSpentDead: integer("total_time_spent_dead"),
    longestTimeSpentLiving: integer("longest_time_spent_living"),
    largestKillingSpree: integer("largest_killing_spree"),
    largestMultiKill: integer("largest_multi_kill"),
    killingSprees: integer("killing_sprees"),
    doubleKills: integer("double_kills"),
    tripleKills: integer("triple_kills"),
    quadraKills: integer("quadra_kills"),
    pentaKills: integer("penta_kills"),
    firstBloodKill: integer("first_blood_kill", { mode: "boolean" }),
    firstBloodAssist: integer("first_blood_assist", { mode: "boolean" }),
    firstTowerKill: integer("first_tower_kill", { mode: "boolean" }),
    firstTowerAssist: integer("first_tower_assist", { mode: "boolean" }),
    turretKills: integer("turret_kills"),
    turretTakedowns: integer("turret_takedowns"),
    inhibitorKills: integer("inhibitor_kills"),
    inhibitorTakedowns: integer("inhibitor_takedowns"),
    dragonKills: integer("dragon_kills"),
    baronKills: integer("baron_kills"),
    objectivesStolen: integer("objectives_stolen"),
    objectivesStolenAssists: integer("objectives_stolen_assists"),
    gameEndedInSurrender: integer("game_ended_in_surrender", { mode: "boolean" }),
    gameEndedInEarlySurrender: integer("game_ended_in_early_surrender", { mode: "boolean" }),
    teamEarlySurrendered: integer("team_early_surrendered", { mode: "boolean" }),
    summoner1Id: integer("summoner1_id"),
    summoner2Id: integer("summoner2_id"),
    summoner1Casts: integer("summoner1_casts"),
    summoner2Casts: integer("summoner2_casts"),
    item0: integer("item0"),
    item1: integer("item1"),
    item2: integer("item2"),
    item3: integer("item3"),
    item4: integer("item4"),
    item5: integer("item5"),
    item6: integer("item6"),
    perksPrimaryStyle: integer("perks_primary_style"),
    perksSubStyle: integer("perks_sub_style"),
    perksKeystone: integer("perks_keystone"),
    perksJson: text("perks_json", { mode: "json" }).$type<Perks>(),
    challengesJson: text("challenges_json", { mode: "json" }).$type<Record<string, unknown>>(),
    riotIdGameName: text("riot_id_game_name"),
    riotIdTagline: text("riot_id_tagline"),
    summonerName: text("summoner_name"),
    summonerLevel: integer("summoner_level"),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.puuid] }),
    index("idx_participants_puuid").on(t.puuid),
    index("idx_participants_champion").on(t.championId),
  ],
);

/**
 * Full match-timeline JSON. Costs one extra Riot request per match.
 */
export const matchTimelines = sqliteTable("match_timelines", {
  matchId: text("match_id")
    .primaryKey()
    .references(() => matches.matchId, { onDelete: "cascade" }),
  rawJson: text("raw_json", { mode: "json" }).$type<MatchTimeline>().notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

/**
 * Per-player cursors so polls are incremental.
 */
export const ingestState = sqliteTable("ingest_state", {
  puuid: text("puuid")
    .primaryKey()
    .references(() => players.puuid, { onDelete: "cascade" }),
  lastPolledAt: integer("last_polled_at"),
  lastMatchStart: integer("last_match_start"),
  lastRankAt: integer("last_rank_at"),
  lastMasteryAt: integer("last_mastery_at"),
});

/**
 * Append-only rank history. One row per (puuid, queueType) per poll.
 */
export const playerRankSnapshots = sqliteTable(
  "player_rank_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    puuid: text("puuid")
      .notNull()
      .references(() => players.puuid, { onDelete: "cascade" }),
    queueType: text("queue_type").notNull(),
    tier: text("tier"),
    rank: text("rank"),
    leaguePoints: integer("league_points"),
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    hotStreak: integer("hot_streak", { mode: "boolean" }),
    veteran: integer("veteran", { mode: "boolean" }),
    freshBlood: integer("fresh_blood", { mode: "boolean" }),
    inactive: integer("inactive", { mode: "boolean" }),
    capturedAt: integer("captured_at").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<LeagueEntry>(),
  },
  (t) => [index("idx_rank_snapshots_puuid_time").on(t.puuid, t.capturedAt)],
);

/**
 * Champion mastery per (player, champion). Upserted at most once per
 * `--mastery-stale-hours` interval.
 */
export const playerMastery = sqliteTable(
  "player_mastery",
  {
    puuid: text("puuid")
      .notNull()
      .references(() => players.puuid, { onDelete: "cascade" }),
    championId: integer("champion_id").notNull(),
    championPoints: integer("champion_points").notNull(),
    championLevel: integer("champion_level").notNull(),
    lastPlayTime: integer("last_play_time"),
    chestGranted: integer("chest_granted", { mode: "boolean" }),
    tokensEarned: integer("tokens_earned"),
    fetchedAt: integer("fetched_at").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<ChampionMastery>(),
  },
  (t) => [
    primaryKey({ columns: [t.puuid, t.championId] }),
    index("idx_mastery_puuid_points").on(t.puuid, t.championPoints),
  ],
);

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type MatchRow = typeof matches.$inferSelect;
export type NewMatchRow = typeof matches.$inferInsert;
export type MatchParticipantRow = typeof matchParticipants.$inferSelect;
export type NewMatchParticipantRow = typeof matchParticipants.$inferInsert;
export type MatchTimelineRow = typeof matchTimelines.$inferSelect;
export type IngestStateRow = typeof ingestState.$inferSelect;
export type NewIngestStateRow = typeof ingestState.$inferInsert;
export type PlayerRankSnapshotRow = typeof playerRankSnapshots.$inferSelect;
export type PlayerMasteryRow = typeof playerMastery.$inferSelect;
