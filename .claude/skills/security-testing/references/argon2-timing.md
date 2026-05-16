# Argon2 timing-resistance smoke

## What we test

Our login path has two failure modes:

1. **Known user, wrong password** — we look up the user, then call `argon2.verify(hash, candidate)`.
2. **Unknown user** — we cannot call `verify` (no hash to verify against), so a naïve implementation returns immediately. That early return leaks "user does not exist" via timing.

The wrapper in `apps/api/src/modules/auth/password.ts` MUST issue a *dummy* `argon2.verify` against a fixed sentinel hash on the unknown-user path so the two branches take similar wall-clock time. This smoke validates that invariant.

We do NOT test argon2's own constant-time comparator — that is a library guarantee.

## Tolerance derivation

- argon2 with `m=19456, t=2, p=1` on a typical x86-64 CI runner: ~30–50 ms per `verify`.
- Run-to-run jitter from GC, scheduler, and shared CI tenants: empirically ±5–10 ms on the means.
- Mean of 50 samples damps jitter to ≈ `σ / √50`.
- A ±15% tolerance window on the mean is wide enough to be non-flaky on shared CI and tight enough to catch a missing dummy-verify (which moves the unknown-user branch from ~40 ms to <1 ms — a 99% delta).

If you see this test flake on a slower runner, do not relax the tolerance. Reduce sample noise by warming up (10 untimed calls) before the 50 timed calls.

## Harness

```ts
// apps/api/src/modules/auth/__tests__/password-timing.security.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { verifyPasswordForLogin } from "@/modules/auth/password";
import { seedUser } from "@/test/security/factories";

const N = 50;
const WARMUP = 10;

async function meanMs(fn: () => Promise<unknown>) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

describe("password verify is timing-safe across user-existence", () => {
  let knownEmail: string;
  beforeAll(async () => {
    const u = await seedUser({ password: "correct-horse-battery-staple" });
    knownEmail = u.email;
  });

  it("unknown-user branch takes ~ the same time as wrong-password branch", async () => {
    const meanWrong   = await meanMs(() => verifyPasswordForLogin(knownEmail,         "WRONG"));
    const meanUnknown = await meanMs(() => verifyPasswordForLogin("nobody@nowhere.test", "WRONG"));

    const ratio = meanUnknown / meanWrong;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  }, 30_000); // verify is slow; bump default timeout.
});
```

## Failure modes

- **Ratio < 0.85** — unknown-user branch is too fast. Almost always: dummy-verify was removed or never added. Check `password.ts` for a call against `SENTINEL_HASH` in the not-found path.
- **Ratio > 1.15** — unknown-user branch is slower than expected. Usually: dummy verify uses different argon2 params than the production hashes. Re-derive the sentinel with `m=19456, t=2, p=1`.
- **Flake on slow CI** — increase `N` from 50 to 100 before relaxing the tolerance window. The tolerance is a contract; sample size is not.

## What this test does NOT cover

- Database lookup timing (the SELECT on `users` itself takes time and varies). If timing-attack threat modeling demands DB-lookup parity, that is a separate test against a real `pg_stat_statements`-instrumented connection. Out of scope here.
- argon2 hash-collision resistance, KDF correctness, or memory-hardness. Library guarantees.
