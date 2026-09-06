import type { MatchParticipant, MatchTimeline } from '../../riot/types.js';

interface BuildEvent {
  timestamp: number;
  type: string;
  participantId?: number;
  skillSlot?: number;
  levelUpType?: string;
  itemId?: number;
  beforeId?: number;
  afterId?: number;
}
export interface SkillUpgrade { timestamp: number; slot: number; rank: number; order: number }
export interface ShopAction { timestamp: number; action: 'Purchased' | 'Sold' | 'Undo'; items: number[] }
export function championBuild(timeline: MatchTimeline | undefined, participantId: number | undefined) {
  const skills: SkillUpgrade[] = [], shop: ShopAction[] = [];
  if (!timeline || !participantId) return { skills, shop };
  const events = timeline.info.frames.flatMap(frame => {
    const events = (frame as { events?: unknown })?.events;
    return Array.isArray(events) ? events : [];
  }).filter((e): e is BuildEvent => e != null && typeof e === 'object'
    && e.participantId === participantId && Number.isFinite(e.timestamp) && e.timestamp >= 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const ranks = new Map<number, number>();
  const validItem = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
  for (const e of events) {
    if (e.type === 'SKILL_LEVEL_UP' && e.levelUpType === 'NORMAL' && [1, 2, 3, 4].includes(e.skillSlot ?? 0)) {
      const slot = e.skillSlot!;
      const rank = (ranks.get(slot) ?? 0) + 1;
      ranks.set(slot, rank);
      skills.push({ timestamp: e.timestamp, slot, rank, order: skills.length + 1 });
    }
    if ((e.type === 'ITEM_PURCHASED' || e.type === 'ITEM_SOLD') && validItem(e.itemId)) {
      shop.push({ timestamp: e.timestamp, action: e.type === 'ITEM_PURCHASED' ? 'Purchased' : 'Sold', items: [e.itemId] });
    } else if (e.type === 'ITEM_UNDO') {
      const items = [...new Set([e.beforeId, e.afterId].filter(validItem))];
      if (items.length) shop.push({ timestamp: e.timestamp, action: 'Undo', items });
    }
  }
  return { skills, shop };
}

/** Missing team stats make the share unknown rather than inflating a percentage. */
export function teamShare(player: MatchParticipant, members: MatchParticipant[], field: keyof MatchParticipant): number | null {
  const values = members.map(p => p[field]);
  const value = player[field];
  if (typeof value !== 'number' || !Number.isFinite(value)
    || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const total = (values as number[]).reduce((sum, n) => sum + n, 0);
  return total > 0 ? value / total * 100 : null;
}
