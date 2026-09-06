import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Match, MatchTimeline } from '../src/riot/types.js';
import { championBuild, teamShare } from '../src/web/lib/champion-analysis.js';
import { matchGraphData } from '../src/web/lib/match-graphs.js';
import { renderableEvents } from '../src/web/lib/match-helpers.js';
import { openDb } from '../src/db/connect.js';
import { insertMatch, insertMatchTimeline } from '../src/db/queries.js';
import { createApp } from '../src/web/server.js';

const match = Match.parse({
  metadata: { dataVersion: '2', matchId: 'EUW1_graph-test', participants: ['new-blue', 'new-red'] },
  info: { platformId: 'EUW1', gameCreation: 1, gameStartTimestamp: 1, gameDuration: 93, gameVersion: '16.17.1', queueId: 440, gameMode: 'CLASSIC', gameType: 'MATCHED_GAME', mapId: 11,
    participants: [
      { champLevel: 19, kills: 3, deaths: 2, assists: 1, participantId: 7, puuid: 'new-red', teamId: 200, championId: 2, championName: 'Olaf', riotIdGameName: '</script><script>alert(1)</script>', win: true },
      { champLevel: 17, kills: 2, deaths: 3, assists: 1, participantId: 2, puuid: 'new-blue', teamId: 100, championId: 120, championName: 'Hecarim', win: false },
    ],
  },
});
const pf = (id: number, gold: number, level: number) => ({ participantId: id, totalGold: gold, level, minionsKilled: 12, jungleMinionsKilled: 4, xp: 123, damageStats: { totalDamageDoneToChampions: 456, totalDamageTaken: 789 } });
const timeline = MatchTimeline.parse({
  metadata: match.metadata,
  info: { frameInterval: 60000, participants: [{ participantId: 2, puuid: 'old-blue' }, { participantId: 7, puuid: 'old-red' }],
    frames: [
      { timestamp: 93000, participantFrames: { '2': pf(2, 1000, 17), '7': pf(7, 1200, 19) }, events: [
        { type: 'WARD_PLACED', timestamp: 85000, creatorId: 7, wardType: 'UNDEFINED' },
        { type: 'WARD_PLACED', timestamp: 90000, creatorId: 7, wardType: 'CONTROL_WARD' },
      ] },
      { timestamp: 0, participantFrames: { '2': pf(2, 500, 1), '7': pf(7, 500, 1) }, events: [] },
      { timestamp: 60000, participantFrames: { '7': { participantId: 7, totalGold: 600, level: 2, damageStats: { totalDamageDoneToChampions: 0 } } }, events: [
        { type: 'CHAMPION_KILL', timestamp: 45000, killerId: 7, victimId: 2, assistingParticipantIds: [4] },
        { type: 'WARD_KILL', timestamp: 46000, killerId: 2, wardType: 'YELLOW_TRINKET' },
      ] },
    ],
  },
});
const data = matchGraphData(match, timeline, new Map([['new-blue', 'Tracked']]));
assert.deepEqual(data.timestamps, [0, 60000, 93000], 'real timestamps, sorted, with partial final minute');
assert.deepEqual(data.teamGold, [0, null, -200], 'incomplete team totals must not imply a lead');
const red = data.players.find(p => p.id === 7)!;
assert.equal(red.teamId, 200, 'participant order does not determine team');
assert.deepEqual(red.values.level, [1, 2, 19], 'levels above 18 are retained');
assert.deepEqual(red.values.damage, [456, 0, 456], 'zero is a valid observed value');
assert.deepEqual(red.values.cs, [16, null, 16], 'CS includes jungle, missing CS stays missing');
assert.deepEqual(red.values.taken, [789, null, 789]);
assert.deepEqual(data.players.find(p => p.id === 2)!.values.gold, [500, null, 1000], 'rotated PUUIDs do not lose participant mapping');
const noIds = structuredClone(match);
noIds.info.participants.forEach(p => { delete p.participantId; });
const fallback = structuredClone(timeline);
fallback.info.participants = [{ participantId: 2, puuid: 'new-blue' }, { participantId: 7, puuid: 'new-red' }];
assert.deepEqual(matchGraphData(noIds, fallback, new Map()).teamGold, [0, null, -200], 'PUUID fallback for older match payloads');
assert.deepEqual(matchGraphData(match, { ...timeline, info: { ...timeline.info, frames: [] } }, new Map()).timestamps, []);
assert.equal(data.moments.length, 1, 'wards are not key moments');
assert.match(data.moments[0]!.text, /First kill/);
assert.deepEqual(matchGraphData(match, {...timeline,info:{...timeline.info,frames:[null,{}, {timestamp:0, participantFrames:{}}]}},new Map()).moments, [], 'sparse graph data without event arrays is usable');
const buildTimeline = structuredClone(timeline);
buildTimeline.info.frames.push({ timestamp: 92000, events: [
  {type:'SKILL_LEVEL_UP',participantId:7,timestamp:5,skillSlot:1,levelUpType:'NORMAL'},
  {type:'SKILL_LEVEL_UP',participantId:7,timestamp:10,skillSlot:2,levelUpType:'NORMAL'},
  {type:'SKILL_LEVEL_UP',participantId:7,timestamp:15,skillSlot:1,levelUpType:'NORMAL'},
  {type:'SKILL_LEVEL_UP',participantId:7,timestamp:20,skillSlot:1,levelUpType:'EVOLVE'},
  {type:'SKILL_LEVEL_UP',participantId:2,timestamp:25,skillSlot:4,levelUpType:'NORMAL'},
  {type:'ITEM_PURCHASED',participantId:7,timestamp:50,itemId:1001},
  {type:'ITEM_UNDO',participantId:7,timestamp:60,beforeId:1001,afterId:0},
  {type:'ITEM_SOLD',participantId:7,timestamp:70,itemId:2003},
  {type:'ITEM_DESTROYED',participantId:7,timestamp:80,itemId:1001},
  {type:'ITEM_PURCHASED',participantId:0,timestamp:90,itemId:3865},
] });
const build=championBuild(buildTimeline,7);
assert.deepEqual(build.skills.map(s=>[s.slot,s.rank,s.order]),[[1,1,1],[2,1,2],[1,2,3]],'upgrades are ordered per ability, and evolutions are not skill points');
assert.deepEqual(build.shop.map(s=>[s.action,s.items]),[['Purchased',[1001]],['Undo',[1001]],['Sold',[2003]]],'preserve undo and sale ledger without counting component destruction or other participants');
assert.deepEqual(championBuild(undefined,7),{skills:[],shop:[]});
const sharingPlayer={...match.info.participants[0]!,goldEarned:100};
assert.equal(teamShare(sharingPlayer,[sharingPlayer,{...sharingPlayer,goldEarned:300}],'goldEarned'),25);
assert.equal(teamShare(sharingPlayer,[sharingPlayer,match.info.participants[1]!],'goldEarned'),null);
assert.equal(teamShare({...sharingPlayer,goldEarned:0},[{...sharingPlayer,goldEarned:0}],'goldEarned'),null);
const events = renderableEvents(match, timeline);
assert.deepEqual(events.map(e => e.timestamp), [45000, 46000, 90000]);
assert.deepEqual(events[0]!.participantIds, [7, 2, 4], 'killer, victim and assists are filterable');
assert.equal(events[1]!.text, 'Hecarim destroyed a stealth ward');
assert.equal(events[2]!.text, 'Olaf placed a control ward');

const dir = mkdtempSync(join(tmpdir(), 'lol-graphs-test-'));
const db = openDb(join(dir, 'test.db'));
try {
  insertMatch(db, match);
  const app = createApp(db);
  let html = await (await app.request('/matches/EUW1_graph-test?tab=graphs')).text();
  assert.match(html, /No timeline data/);
  const emptyChampion = await (await app.request('/matches/EUW1_graph-test?tab=champions')).text();
  assert.match(emptyChampion,/No skill upgrades recorded/);
  assert.match(emptyChampion,/Damage profile/);
  insertMatchTimeline(db, match.metadata.matchId, timeline);
  for (const url of ['/matches/EUW1_graph-test?tab=graphs', '/fragments/match/EUW1_graph-test/graphs', '/fragments/match/EUW1_graph-test/gold']) {
    const response = await app.request(url);
    assert.equal(response.status, 200);
    html = await response.text();
    assert.match(html, /data-match-graphs=/);
    assert.ok(!html.includes('</script><script>alert(1)</script>'), 'untrusted player names must be escaped');
    assert.match(html, /Team gold lead/);
  }
  const championHtml = await (await app.request('/fragments/match/EUW1_graph-test/champions')).text();
  assert.match(championHtml,/Shopping history/);
  assert.match(championHtml,/data-champion-pick/);
  assert.ok(!championHtml.includes('</script><script>alert(1)</script>'));
  const legacyMatch=structuredClone(noIds);
  legacyMatch.metadata.matchId='EUW1_legacy-build';
  insertMatch(db,legacyMatch);
  const legacyTimeline=structuredClone(buildTimeline);
  legacyTimeline.info.participants=fallback.info.participants;
  insertMatchTimeline(db,legacyMatch.metadata.matchId,legacyTimeline);
  const legacyHtml=await (await app.request('/fragments/match/EUW1_legacy-build/champions')).text();
  assert.match(legacyHtml,/Q rank 2 at 0:00/,'legacy participant ID lookup retains skill order');
  assert.match(legacyHtml,/data-item-name="1001"/,'legacy participant ID lookup retains purchases');
  const timelineHtml = await (await app.request('/fragments/match/EUW1_graph-test/timeline')).text();
  assert.match(timelineHtml, /data-event-players="7 2 4"/);
  assert.match(timelineHtml, /data-event-kind="ward"/);
  assert.equal((await app.request('/fragments/match/missing/graphs')).status, 404);
  assert.equal((await app.request('/static/match-graphs.js')).status, 200);
  console.log('Match graphs smoke checks passed.');
} finally {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
}
