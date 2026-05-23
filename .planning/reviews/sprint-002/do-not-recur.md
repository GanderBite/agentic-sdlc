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
