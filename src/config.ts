import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  RIOT_API_KEY: z.string().min(10, "RIOT_API_KEY missing — copy .env.example to .env"),
  LOL_TRACKER_DB: z.string().default("./data/lol-tracker.db"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  return parsed.data;
}

export const PLATFORM_TO_REGION: Record<string, "americas" | "europe" | "asia" | "sea"> = {
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  kr: "asia",
  jp1: "asia",
  oc1: "sea",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea",
};

export type Platform = keyof typeof PLATFORM_TO_REGION;
export type Region = "americas" | "europe" | "asia" | "sea";

export function isPlatform(s: string): s is Platform {
  return s in PLATFORM_TO_REGION;
}

export function regionFor(platform: Platform): Region {
  return PLATFORM_TO_REGION[platform] as Region;
}

export function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
