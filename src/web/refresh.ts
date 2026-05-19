import type { PollResult } from "../ingest/poll.js";

export interface RefreshSummary {
  ranAt: number;
  newMatches: number;
  newTimelines: number;
  errors: number;
  durationMs: number;
}

export type RefreshState =
  | { kind: "idle"; lastResult: RefreshSummary | null }
  | { kind: "running"; startedAt: number }
  | { kind: "cooldown"; remainingMs: number; lastResult: RefreshSummary }
  | { kind: "disabled"; reason: string };

export type RefreshRequestResult =
  | { kind: "started" }
  | { kind: "busy" }
  | { kind: "cooldown"; remainingMs: number }
  | { kind: "disabled"; reason: string };

export interface RefreshController {
  request(opts?: RefreshRequestOptions): RefreshRequestResult;
  getState(): RefreshState;
  cooldownMs(): number;
}

export interface RefreshRequestOptions {
  /** Skip the cooldown check; the in-flight lock is still respected. */
  bypassCooldown?: boolean;
  /** Trigger label forwarded to the run function (e.g. for log output). */
  trigger?: string;
}

export interface RefreshControllerOptions {
  cooldownMs: number;
  run: (trigger: string) => Promise<PollResult[]>;
  /** Return a string to mark refresh disabled (e.g. key mismatch), or null. */
  isDisabled?: () => string | null;
  onError?: (err: unknown) => void;
}

export function createRefreshController(
  opts: RefreshControllerOptions,
): RefreshController {
  let running = false;
  let lastStartedAt = 0;
  let lastFinishedAt = 0;
  let lastResult: RefreshSummary | null = null;

  const disabledReason = (): string | null => opts.isDisabled?.() ?? null;

  const cooldownRemaining = (): number => {
    if (lastFinishedAt === 0) return 0;
    return Math.max(0, lastFinishedAt + opts.cooldownMs - Date.now());
  };

  function getState(): RefreshState {
    const reason = disabledReason();
    if (reason) return { kind: "disabled", reason };
    if (running) return { kind: "running", startedAt: lastStartedAt };
    const remaining = cooldownRemaining();
    if (remaining > 0 && lastResult) {
      return { kind: "cooldown", remainingMs: remaining, lastResult };
    }
    return { kind: "idle", lastResult };
  }

  function request(req?: RefreshRequestOptions): RefreshRequestResult {
    const reason = disabledReason();
    if (reason) return { kind: "disabled", reason };
    if (running) return { kind: "busy" };
    if (!req?.bypassCooldown) {
      const remaining = cooldownRemaining();
      if (remaining > 0) return { kind: "cooldown", remainingMs: remaining };
    }

    running = true;
    lastStartedAt = Date.now();
    const trigger = req?.trigger ?? "manual";
    void (async () => {
      const t0 = Date.now();
      try {
        const results = await opts.run(trigger);
        lastResult = {
          ranAt: Date.now(),
          newMatches: results.reduce((s, r) => s + r.newMatches, 0),
          newTimelines: results.reduce((s, r) => s + r.timelines, 0),
          errors: results.filter((r) => r.error).length,
          durationMs: Date.now() - t0,
        };
      } catch (e) {
        opts.onError?.(e);
        lastResult = {
          ranAt: Date.now(),
          newMatches: 0,
          newTimelines: 0,
          errors: 1,
          durationMs: Date.now() - t0,
        };
      } finally {
        running = false;
        lastFinishedAt = Date.now();
      }
    })();
    return { kind: "started" };
  }

  return { request, getState, cooldownMs: () => opts.cooldownMs };
}
