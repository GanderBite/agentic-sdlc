import { TooManyRequestsError } from "../../shared/errors.js";

export type LoginThrottleOptions = {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
};

export type LoginThrottle = {
  check(params: { ip: string; email: string }): void;
};

/**
 * Factory that creates a per-(IP, lowercased-email) rolling-window login throttle.
 *
 * Default: 10 attempts per 15-minute window, in-memory.
 * The `now` clock is injectable for deterministic testing.
 */
export function createLoginThrottle({
  limit = 10,
  windowMs = 15 * 60 * 1000,
  now = Date.now,
}: LoginThrottleOptions = {}): LoginThrottle {
  const store = new Map<string, number[]>();

  return {
    check({ ip, email }: { ip: string; email: string }): void {
      const key = `${ip}|${email.toLowerCase()}`;
      const currentTime = now();
      const cutoff = currentTime - windowMs;

      // Retrieve existing timestamps or start fresh
      const existing = store.get(key);
      const timestamps: number[] = existing !== undefined ? existing : [];

      // Rolling window: prune timestamps older than the window
      const pruned = timestamps.filter((ts) => ts > cutoff);

      if (pruned.length >= limit) {
        // Update the store with pruned state before throwing
        store.set(key, pruned);
        throw new TooManyRequestsError(
          `Too many login attempts. Please try again after ${Math.ceil(windowMs / 60_000)} minutes.`,
        );
      }

      // Record this attempt
      pruned.push(currentTime);
      store.set(key, pruned);
    },
  };
}
