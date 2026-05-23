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
