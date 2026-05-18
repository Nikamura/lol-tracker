const DEFAULT_VERSION = "14.24.1";
const CDN = "https://ddragon.leagueoflegends.com/cdn";

/**
 * Riot's `match.info.gameVersion` looks like "14.24.498.6553"; Data Dragon
 * publishes assets at "14.24.1". Take the first two segments and append ".1".
 */
export function ddragonVersion(gameVersion: string | null | undefined): string {
  if (!gameVersion) return DEFAULT_VERSION;
  const parts = gameVersion.split(".");
  if (parts.length < 2) return DEFAULT_VERSION;
  return `${parts[0]}.${parts[1]}.1`;
}

const CHAMPION_NAME_FIXUPS: Record<string, string> = {
  FiddleSticks: "Fiddlesticks",
  Wukong: "MonkeyKing",
};

export function championIcon(version: string, championName: string): string {
  const fixed = CHAMPION_NAME_FIXUPS[championName] ?? championName;
  return `${CDN}/${version}/img/champion/${fixed}.png`;
}

export function itemIcon(version: string, itemId: number): string {
  return `${CDN}/${version}/img/item/${itemId}.png`;
}

const SUMMONER_SPELL_NAMES: Record<number, string> = {
  1: "SummonerBoost",
  3: "SummonerExhaust",
  4: "SummonerFlash",
  6: "SummonerHaste",
  7: "SummonerHeal",
  11: "SummonerSmite",
  12: "SummonerTeleport",
  13: "SummonerMana",
  14: "SummonerDot",
  21: "SummonerBarrier",
  30: "SummonerPoroRecall",
  31: "SummonerPoroThrow",
  32: "SummonerSnowball",
  39: "SummonerSnowURFSnowball_Mark",
  54: "Summoner_UltBookPlaceholder",
};

export function summonerSpellIcon(version: string, spellId: number | null | undefined): string | undefined {
  if (spellId == null) return undefined;
  const key = SUMMONER_SPELL_NAMES[spellId];
  if (!key) return undefined;
  return `${CDN}/${version}/img/spell/${key}.png`;
}

const RUNE_TREES: Record<number, { key: string; label: string }> = {
  8000: { key: "7201_Precision", label: "Precision" },
  8100: { key: "7200_Domination", label: "Domination" },
  8200: { key: "7202_Sorcery", label: "Sorcery" },
  8300: { key: "7203_Whimsy", label: "Inspiration" },
  8400: { key: "7204_Resolve", label: "Resolve" },
};

export function runeTreeIcon(treeId: number | null | undefined): string | undefined {
  if (treeId == null) return undefined;
  const tree = RUNE_TREES[treeId];
  if (!tree) return undefined;
  return `https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${tree.key}.png`;
}

export function runeTreeLabel(treeId: number | null | undefined): string | undefined {
  if (treeId == null) return undefined;
  return RUNE_TREES[treeId]?.label;
}
