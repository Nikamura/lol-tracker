export const QUEUE_NAMES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  700: "Clash",
  720: "ARAM Clash",
  830: "Co-op vs AI Intro",
  840: "Co-op vs AI Beginner",
  850: "Co-op vs AI Intermediate",
  900: "URF",
  1700: "Arena",
  1710: "Arena",
  1900: "URF",
};

export const GAME_MODE_LABEL: Record<string, string> = {
  CHERRY: "Arena",
  ARAM: "ARAM",
  URF: "URF",
  CLASSIC: "Classic",
};

export function queueLabel(queueId: number, gameMode: string): string {
  return QUEUE_NAMES[queueId] ?? GAME_MODE_LABEL[gameMode] ?? gameMode;
}

export function isArena(queueId: number, gameMode: string | undefined | null): boolean {
  if (queueId === 1700 || queueId === 1710) return true;
  return gameMode === "CHERRY";
}

export const QUEUE_GROUPS: Record<string, number[]> = {
  ranked: [420, 440],
  soloq: [420],
  flex: [440],
  normal: [400, 430, 490],
  aram: [450],
  arena: [1700],
};

export function resolveQueueFilter(input: string | undefined): number[] | undefined {
  if (!input) return undefined;
  const key = input.toLowerCase();
  const group = QUEUE_GROUPS[key];
  if (group) return group;
  const n = Number(input);
  if (!Number.isFinite(n)) throw new Error(`Unknown queue filter: ${input}`);
  return [n];
}

export function parseSince(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const m = /^(\d+)([dhm])$/.exec(input);
  if (!m) throw new Error(`since must look like '7d', '12h', or '30m'. Got: ${input}`);
  const n = Number(m[1]);
  const unit = m[2] as "d" | "h" | "m";
  const ms = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return Date.now() - n * ms;
}
