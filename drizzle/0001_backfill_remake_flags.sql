-- Backfill the early-surrender flags on `match_participants` from the full
-- match payload stored in `matches.raw_json`. Older rows were ingested with
-- these columns left NULL (the Riot zod schema marks them optional), which
-- broke the remake filter and the "Early FF" / "Surrender" badges in the
-- timeline. Pulling the values straight out of the raw JSON avoids a Riot
-- API round-trip and is idempotent (only NULLs are touched).

UPDATE match_participants
SET game_ended_in_early_surrender = (
  SELECT json_extract(p.value, '$.gameEndedInEarlySurrender')
  FROM matches m, json_each(json_extract(m.raw_json, '$.info.participants')) p
  WHERE m.match_id = match_participants.match_id
    AND json_extract(p.value, '$.puuid') = match_participants.puuid
)
WHERE game_ended_in_early_surrender IS NULL;
--> statement-breakpoint
UPDATE match_participants
SET team_early_surrendered = (
  SELECT json_extract(p.value, '$.teamEarlySurrendered')
  FROM matches m, json_each(json_extract(m.raw_json, '$.info.participants')) p
  WHERE m.match_id = match_participants.match_id
    AND json_extract(p.value, '$.puuid') = match_participants.puuid
)
WHERE team_early_surrendered IS NULL;
--> statement-breakpoint
UPDATE match_participants
SET game_ended_in_surrender = (
  SELECT json_extract(p.value, '$.gameEndedInSurrender')
  FROM matches m, json_each(json_extract(m.raw_json, '$.info.participants')) p
  WHERE m.match_id = match_participants.match_id
    AND json_extract(p.value, '$.puuid') = match_participants.puuid
)
WHERE game_ended_in_surrender IS NULL;
