[medium] tsconfig module=ESNext paired with moduleResolution=NodeNext (TS5095) — auto_fixable=true — first_seen=wave-1
[low] root package.json missing engines.node when ARCHITECTURE pins a Node version — auto_fixable=true — first_seen=wave-1
[low] new TS source files use double-quote string literals while biome.json mandates quoteStyle=single — auto_fixable=true — first_seen=wave-2
[medium] vitest integration config uses sequence.concurrent:false instead of fileParallelism:false; multi-file testcontainer runs race — auto_fixable=true — first_seen=wave-3
[medium] workspace lint script scoped to src/ only; misses test/, drizzle.config.ts, vitest configs — auto_fixable=true — first_seen=wave-3
[low] tsconfig include=src/**/*.ts excludes root-level tool configs from typecheck — auto_fixable=false — first_seen=wave-3
[medium] db initialised with `schema: {} as any` defeats drizzle relational query API and trips biome noExplicitAny — auto_fixable=false — first_seen=wave-4
[low] AppError.code typed as string instead of ErrorCode union from @medbridge/contracts — auto_fixable=true — first_seen=wave-4
[low] password.ts verify() parameter name `hash` shadows the exported `hash` function — auto_fixable=true — first_seen=wave-4
[low] db.ts passes DATABASE_URL to Pool without runtime presence check, silent libpq fallback on misconfig — auto_fixable=false — first_seen=wave-4
[blocking] csrf middleware exempts wrong route prefixes (/v1/auth/...) instead of /api/auth.* RPC paths used by routes — auto_fixable=true — first_seen=wave-5
[medium] in-memory login-throttle Map never evicts emptied keys; unbounded growth under per-IP/email attack — auto_fixable=false — first_seen=wave-5
[medium] Hono ctx variables (requestId,log,user) used via untyped `as` casts across middleware; no typed HonoEnv Variables interface — auto_fixable=false — first_seen=wave-5
[low] csrf UNSAFE_METHODS includes PUT but ARCHITECTURE §5.4 enumerates only POST/PATCH/DELETE — auto_fixable=false — first_seen=wave-5
[low] AppError.statusCode is `number` (wider than Hono StatusCode union); errorHandler casts via Parameters<typeof c.json>[1] — auto_fixable=false — first_seen=wave-5
[blocking] refresh token rotation: revoke update return value ignored, two concurrent refreshes can both issue new tokens (B4 single-use breaks) — auto_fixable=false — first_seen=wave-6
[high] auth/service.ts runs direct drizzle select on userTable (findUserById), bypassing repo layer per ARCHITECTURE §2.3 — auto_fixable=false — first_seen=wave-6
[high] auth/service.ts imports another module's schema.ts (accounts/schema userTable) — ARCHITECTURE §2.3 explicitly forbids — auto_fixable=false — first_seen=wave-6
[medium] auth/repo.ts queries accounts.user table directly; ARCHITECTURE §2.3 says repo.ts never imports another module — auto_fixable=false — first_seen=wave-6
[medium] seed/main.ts does direct drizzle insert into accounts schema instead of calling accounts repo layer per ARCHITECTURE §2.2 — auto_fixable=false — first_seen=wave-6
[low] expired-refresh-token revoke runs inside tx then throws; rollback undoes the intended revoke — auto_fixable=false — first_seen=wave-6
[low] DUMMY_HASH argon2id parameters hard-coded in auth/service.ts; drift from shared/password.ts hash() silently breaks B7 constant-time — auto_fixable=false — first_seen=wave-6
[blocking] auth/routes.ts adopts wrong /v1/auth/{login,refresh,logout,me} prefix matching wave-5 csrf bug instead of contract-mandated /api/auth.{login,refresh,logout,me} (B3/B4/B5) — auto_fixable=true — first_seen=wave-7
[medium] auth/dto.ts decodes JWT payload it just signed to populate response user; service.login/refresh should return user object alongside tokens to avoid the unsafe-decode pattern — auto_fixable=false — first_seen=wave-7
[medium] await c.req.json() in route handlers throws SyntaxError on malformed body, surfaces as 500 INTERNAL via errorHandler instead of 422 VALIDATION per ARCHITECTURE §5.2 — auto_fixable=true — first_seen=wave-7
[low] dto.ts buildMeResponse re-validates user.role against {patient,doctor} that authn middleware already narrowed; same guard appears in 3 places — auto_fixable=false — first_seen=wave-7
[low] apps/api/README.md documents `pnpm -F @medbridge/api db:seed` but apps/api/package.json defines no db:seed script — auto_fixable=false — first_seen=wave-7
[medium] main.ts PORT env coerced via Number() without isInteger/range validation; non-numeric values yield NaN and undefined serve() behavior — auto_fixable=true — first_seen=wave-8
[low] graceful shutdown calls pool.end().then() without .catch; pool close rejection leaves server hung without exit — auto_fixable=false — first_seen=wave-8
[high] test/support/passwords.ts wraps argon2 directly so vi.spyOn never intercepts production calls (shared/password.ts is the real import path); B7 spy contract broken — auto_fixable=false — first_seen=wave-9
[high] test/support/logCapture.ts builds a stream but never swaps shared/logger.ts pino instance; B14 capture has no working path through this helper — auto_fixable=false — first_seen=wave-9
[medium] test/support/container.ts withReuse() violates ARCHITECTURE §8 ephemeral-per-file when vitest fileParallelism is not disabled — auto_fixable=false — first_seen=wave-9
[medium] test/support/fixtures.ts loadRawFixtures() duplicates seed/main.ts loadFixtures(); single fixture parser should live under src/seed/fixtures/ — auto_fixable=false — first_seen=wave-9
[low] container.ts migration pool not wrapped in try/finally; pool leaks on migrate() throw — auto_fixable=true — first_seen=wave-9
[low] request.ts cookie deletion detects max-age=0 but not past-date Expires; brittle if hono/cookie deleteCookie ever emits Expires instead — auto_fixable=false — first_seen=wave-9
[blocking] authn middleware calls jwtVerify without clockTolerance; jose v5 default is 0s so B12's 5s skew guarantee is silently absent — auto_fixable=true — first_seen=wave-10
[high] vi.spyOn(prodModule, 'fn') after a closure already captured the property by-value — spy never intercepts, toHaveBeenCalledTimes always observes 0 — auto_fixable=false — first_seen=wave-10
[high] log-redaction integration test exercises buildCapturingLogger directly instead of production middleware/logger.ts; middleware never serialises req.headers so shared/logger.ts redact paths have no runtime coverage — auto_fixable=false — first_seen=wave-10
[high] integration test substitutes always-true verifyPassword stub instead of createPasswordVerifier().verify; silently masks any real argon2 regression — auto_fixable=false — first_seen=wave-10
[medium] one wave-10 test file rolls its own PostgreSqlContainer + withReuse() branch instead of the shared startPostgres() helper used by sibling files — auto_fixable=false — first_seen=wave-10
[medium] hashRefreshToken / signSessionJwt redefined verbatim in every integration test file; five copies must stay in lock-step with main.ts — auto_fixable=false — first_seen=wave-10
[medium] log-redaction.test uses vi.spyOn(process.stdout,'write') ad-hoc; the workaround for wave-9 logCapture gap should be promoted into test/support — auto_fixable=false — first_seen=wave-10
[low] seed integration test spawns tsx subprocess instead of importing seed/main.ts and calling exported main(); ~600ms cold-start tax per run — auto_fixable=false — first_seen=wave-10
[blocking] biome.json shape incompatible with biome 2.4.15 (organizeImports/files.ignore/overrides.include); pnpm -w lint short-circuits on config errors — auto_fixable=true — first_seen=review-iter-1
[blocking] default `pnpm --filter @medbridge/api test` exits 1 with no-tests-found; vitest.config.ts only includes src/**/*.test.ts while integration suites live under test/** behind a separate :integration script — auto_fixable=true — first_seen=review-iter-1
[low] app.ts middleware-chain comment claims `requestId → logger → csrf → authn → authz` but only the first three are global; authn is per-route only — drift between intended chain (ARCHITECTURE §1 diagram) and what's wired — auto_fixable=false — first_seen=review-iter-1
[low] authn middleware reads JWT_SECRET via process.env per-request; mutating env mid-process changes auth behaviour silently (test cross-file bleed risk) — auto_fixable=false — first_seen=review-iter-1
[info] integration test files contain block comments DOCUMENTING the csrf path mismatch as expected behaviour ('a subsequent PR must align...'); production bug shipped with prose acknowledgment in tests instead of being fixed — auto_fixable=false — first_seen=review-iter-1
[info] ARCHITECTURE §6.1 mandates /api/<resource>.<verb> route names but sprint-002 implementation uses /api/<verb>; contract ambiguity is the real root of the csrf path-mismatch saga — auto_fixable=false — first_seen=review-iter-1
