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

const CHAMPION_NAME_BY_ID: Record<number, string> = {
  1: "Annie", 2: "Olaf", 3: "Galio", 4: "TwistedFate", 5: "XinZhao", 6: "Urgot",
  7: "Leblanc", 8: "Vladimir", 9: "Fiddlesticks", 10: "Kayle", 11: "MasterYi",
  12: "Alistar", 13: "Ryze", 14: "Sion", 15: "Sivir", 16: "Soraka", 17: "Teemo",
  18: "Tristana", 19: "Warwick", 20: "Nunu", 21: "MissFortune", 22: "Ashe",
  23: "Tryndamere", 24: "Jax", 25: "Morgana", 26: "Zilean", 27: "Singed",
  28: "Evelynn", 29: "Twitch", 30: "Karthus", 31: "Chogath", 32: "Amumu",
  33: "Rammus", 34: "Anivia", 35: "Shaco", 36: "DrMundo", 37: "Sona",
  38: "Kassadin", 39: "Irelia", 40: "Janna", 41: "Gangplank", 42: "Corki",
  43: "Karma", 44: "Taric", 45: "Veigar", 48: "Trundle", 50: "Swain",
  51: "Caitlyn", 53: "Blitzcrank", 54: "Malphite", 55: "Katarina", 56: "Nocturne",
  57: "Maokai", 58: "Renekton", 59: "JarvanIV", 60: "Elise", 61: "Orianna",
  62: "MonkeyKing", 63: "Brand", 64: "LeeSin", 67: "Vayne", 68: "Rumble",
  69: "Cassiopeia", 72: "Skarner", 74: "Heimerdinger", 75: "Nasus", 76: "Nidalee",
  77: "Udyr", 78: "Poppy", 79: "Gragas", 80: "Pantheon", 81: "Ezreal",
  82: "Mordekaiser", 83: "Yorick", 84: "Akali", 85: "Kennen", 86: "Garen",
  89: "Leona", 90: "Malzahar", 91: "Talon", 92: "Riven", 96: "KogMaw",
  98: "Shen", 99: "Lux", 101: "Xerath", 102: "Shyvana", 103: "Ahri",
  104: "Graves", 105: "Fizz", 106: "Volibear", 107: "Rengar", 110: "Varus",
  111: "Nautilus", 112: "Viktor", 113: "Sejuani", 114: "Fiora", 115: "Ziggs",
  117: "Lulu", 119: "Draven", 120: "Hecarim", 121: "Khazix", 122: "Darius",
  126: "Jayce", 127: "Lissandra", 131: "Diana", 133: "Quinn", 134: "Syndra",
  136: "AurelionSol", 141: "Kayn", 142: "Zoe", 143: "Zyra", 145: "Kaisa",
  147: "Seraphine", 150: "Gnar", 154: "Zac", 157: "Yasuo", 161: "Velkoz",
  163: "Taliyah", 164: "Camille", 166: "Akshan", 200: "Belveth", 201: "Braum",
  202: "Jhin", 203: "Kindred", 221: "Zeri", 222: "Jinx", 223: "TahmKench",
  233: "Briar", 234: "Viego", 235: "Senna", 236: "Lucian", 238: "Zed",
  240: "Kled", 245: "Ekko", 246: "Qiyana", 254: "Vi", 266: "Aatrox",
  267: "Nami", 268: "Azir", 350: "Yuumi", 360: "Samira", 412: "Thresh",
  420: "Illaoi", 421: "RekSai", 427: "Ivern", 429: "Kalista", 432: "Bard",
  497: "Rakan", 498: "Xayah", 516: "Ornn", 517: "Sylas", 518: "Neeko",
  523: "Aphelios", 526: "Rell", 555: "Pyke", 711: "Vex", 777: "Yone",
  799: "Ambessa", 875: "Sett", 876: "Lillia", 887: "Gwen", 888: "Renata",
  893: "Aurora", 895: "Nilah", 897: "KSante", 901: "Smolder", 902: "Milio",
  910: "Hwei", 950: "Naafiri",
};

export function championNameById(championId: number): string | undefined {
  return CHAMPION_NAME_BY_ID[championId];
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
