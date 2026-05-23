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
