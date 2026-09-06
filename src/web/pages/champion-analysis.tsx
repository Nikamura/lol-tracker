import type { FC } from 'hono/jsx';
import type { MatchRaw } from '../../db/queries.js';
import { championIcon, ddragonVersion, itemIcon } from '../lib/ddragon.js';
import { championBuild, teamShare } from '../lib/champion-analysis.js';
import { csOf, fmtClock, kpPercent, teamParticipants } from '../lib/match-helpers.js';
const fmt = (n: number | undefined | null) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const keys = ['Q', 'W', 'E', 'R'];

export const ChampionAnalysis: FC<{raw: MatchRaw}> = ({raw}) => {
  const version = ddragonVersion(raw.match.info.gameVersion);
  const players = raw.match.info.participants;
  const selected = players.find(p => raw.trackedNames.has(p.puuid)) ?? players[0];
  return <section class="champion-analysis" data-champion-analysis data-item-version={version} aria-label="Champion analysis">
    <div class="analysis-intro"><span class="analysis-eyebrow">THE INDIVIDUAL GAME</span><h2>Behind the scoreline</h2><p>Follow a champion’s build, skill choices, and contribution to the team.</p></div>
    <div class="champion-picker" aria-label="Choose a champion">
      {players.map(p => <button type="button" data-champion-pick={p.puuid} aria-pressed={p === selected ? 'true' : 'false'} title={p.riotIdGameName ?? p.championName}>
        <img src={championIcon(version,p.championName)} alt="" width="40" height="40"/><span>{p.championName}</span>
      </button>)}
    </div>
    {players.map(p => {
      const team = teamParticipants(raw.match,p.teamId);
      const participantId = p.participantId ?? raw.timeline?.info.participants?.find(tp => tp.puuid === p.puuid)?.participantId;
      const build = championBuild(raw.timeline,participantId);
      const totalDamage = p.totalDamageDealtToChampions;
      const damage = [
        {label:'Physical',value:p.physicalDamageDealtToChampions,color:'#fbbf24'},
        {label:'Magic',value:p.magicDamageDealtToChampions,color:'#818cf8'},
        {label:'True',value:p.trueDamageDealtToChampions,color:'#e2e8f0'},
      ];
      const damageComplete = damage.every(d=>d.value != null);
      const damageSum = damage.reduce((sum,d)=>sum+(d.value??0),0);
      const minutes = raw.match.info.gameDuration / 60;
      return <article data-champion-panel={p.puuid} hidden={p !== selected}>
        <header class="champion-hero">
          <img src={championIcon(version,p.championName)} alt="" width="80" height="80"/>
          <div><span class="analysis-eyebrow">{p.teamId===100?'BLUE':'RED'} TEAM · {p.teamPosition || 'UNASSIGNED'} · {p.win?'VICTORY':'DEFEAT'}</span><h3>{p.championName}</h3><p>{raw.trackedNames.get(p.puuid) ?? p.riotIdGameName ?? p.summonerName}</p></div>
          <div class="champion-kda"><strong>{p.kills}<em> / {p.deaths} / </em>{p.assists}</strong><span>{p.deaths ? ((p.kills+p.assists)/p.deaths).toFixed(2)+' KDA' : 'Deathless'} · Level {p.champLevel}</span></div>
        </header>
        <div class="analysis-stats">
          {[
            ['Damage / min',minutes>0 && totalDamage!=null?totalDamage/minutes:null],
            ['CS / min',minutes>0 && p.totalMinionsKilled!=null && p.neutralMinionsKilled!=null?csOf(p)/minutes:null],
            ['Kill participation',kpPercent(p,team)+'%'],
            ['Vision score',p.visionScore],
          ].map(([label,value])=><div><span>{label}</span><strong>{typeof value==='string'?value:fmt(value as number|undefined|null)}</strong></div>)}
        </div>
        <div class="analysis-columns">
          <section class="analysis-card"><h4>Damage profile</h4><p>Damage dealt to champions</p><strong class="analysis-total">{fmt(totalDamage)}</strong>
            <div class="damage-composition" role="img" aria-label={damageComplete ? damage.map(d=>`${d.label}: ${fmt(d.value)}`).join(', ') : 'Damage breakdown unavailable'}>
              {damageComplete && damageSum>0 && damage.map(d=><span style={`width:${(d.value??0)/damageSum*100}%;background:${d.color}`} />)}
            </div>
            <div class="damage-legend">{damage.map(d=><span><i style={`background:${d.color}`}/>{d.label}<b>{fmt(d.value)}</b></span>)}</div>
          </section>
          <section class="analysis-card"><h4>Share of the team</h4><p>Final match contribution</p>
            {([
              ['Champion damage','totalDamageDealtToChampions'],['Gold earned','goldEarned'],['Turret damage','damageDealtToTurrets'],['Healing allies','totalHealsOnTeammates'],['Shielding allies','totalDamageShieldedOnTeammates'],
            ] as const).map(([label,field])=>{const share=teamShare(p,team,field);return <div class="contribution-row"><span>{label}</span><b>{share==null?'—':share.toFixed(1)+'%'}</b><div><i style={`width:${share??0}%`}/></div></div>;})}
          </section>
        </div>
        <section class="analysis-card"><h4>Skill order</h4><p>Recorded upgrade order, with the time each point was spent. Numbers inside each tile show ability rank.</p>
          {build.skills.length ? <div class="skill-scroll"><div class="skill-grid" style={`grid-template-columns:32px repeat(${build.skills.length}, minmax(38px, 1fr))`}>
            <span/>{build.skills.map(s=><small>{s.order}</small>)}
            {keys.map((key,i)=><><strong class={`skill-key skill-${key}`}>{key}</strong>{build.skills.map(s=><span class={s.slot===i+1?`skill-point skill-${key}`:'skill-blank'} title={s.slot===i+1?`${key} rank ${s.rank} at ${fmtClock(s.timestamp)}`:undefined}>{s.slot===i+1?s.rank:''}</span>)}</>)}
            <span/>{build.skills.map(s=><small>{fmtClock(s.timestamp)}</small>)}
          </div></div>:<p class="analysis-empty">No skill upgrades recorded for this champion.</p>}
        </section>
        <section class="analysis-card"><h4>Shopping history</h4><p>Purchases, sales, and undo actions in order. This is a transaction history; upgrades and consumed items are not an inventory replay.</p>
          {build.shop.length?<ol class="shopping-list">{build.shop.map(e=><li><time>{fmtClock(e.timestamp)}</time><span class={`shop-action shop-${e.action.toLowerCase()}`}>{e.action}</span><div>{e.items.map(id=><span class="shop-item"><img src={itemIcon(version,id)} alt="" width="28" height="28" loading="lazy"/><span data-item-name={id}>Item {id}</span></span>)}</div></li>)}</ol>:<p class="analysis-empty">No shopping events recorded for this champion.</p>}
        </section>
      </article>;
    })}
  </section>;
};
