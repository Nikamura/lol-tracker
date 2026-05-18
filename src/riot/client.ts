import pc from "picocolors";
import type { z } from "zod";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Window {
  limit: number;
  periodMs: number;
  timestamps: number[];
}

class RateLimiter {
  private readonly windows: Window[];

  constructor(limits: { limit: number; periodMs: number }[]) {
    this.windows = limits.map((l) => ({ ...l, timestamps: [] }));
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      for (const w of this.windows) {
        w.timestamps = w.timestamps.filter((t) => now - t < w.periodMs);
      }
      const blocked = this.windows.filter((w) => w.timestamps.length >= w.limit);
      if (blocked.length === 0) {
        for (const w of this.windows) w.timestamps.push(now);
        return;
      }
      const wait = Math.max(
        ...blocked.map((w) => w.periodMs - (now - (w.timestamps[0] ?? now))),
      );
      await sleep(wait + 25);
    }
  }
}

export interface ClientOptions {
  apiKey: string;
  verbose?: boolean;
}

export class RiotClient {
  private readonly apiKey: string;
  private readonly verbose: boolean;
  // Personal-key dev limits. App-rate limits are global across regions.
  private readonly limiter = new RateLimiter([
    { limit: 20, periodMs: 1_000 },
    { limit: 100, periodMs: 120_000 },
  ]);

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.verbose = opts.verbose ?? false;
  }

  async get<T>(host: string, path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `https://${host}${path}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.limiter.acquire();
      if (this.verbose) console.error(pc.dim(`GET ${url}`));
      const res = await fetch(url, { headers: { "X-Riot-Token": this.apiKey } });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
        if (this.verbose) console.error(pc.yellow(`429 — sleeping ${retryAfter}s`));
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      if (res.status === 503 || res.status === 504) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new RiotApiError(res.status, `${res.status} ${res.statusText} for ${url}: ${body}`);
      }
      const json: unknown = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new RiotApiError(
          200,
          `response did not match schema for ${url}: ${parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      return parsed.data;
    }
    throw new RiotApiError(429, `gave up after retries: ${url}`);
  }
}

export class RiotApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "RiotApiError";
  }
}
