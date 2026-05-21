# do-not-recur — sprint-001

One line per non-info finding. Pattern descriptions only — no tool-specific syntax. Read by subsequent task-builders in this sprint and by the planner of the next sprint.

[blocking] verification regex omits leading whitespace + opening quote when matching indented JSON keys — auto_fixable=true — first_seen=wave-1 (escalated on recurrence per R7.3)
[low] root scripts diverge from planner-specified `-r` recursive form without explicit convention update — auto_fixable=false — first_seen=wave-1
[low] root scripts reference helper files that do not exist yet (forward-references to later waves) — auto_fixable=false — first_seen=wave-1
[low] root package.json missing engines.node field despite tech stack pinning a specific Node major — auto_fixable=false — first_seen=wave-1
[blocking] lockfile not regenerated after new workspace package manifests added; frozen-install gate fails — auto_fixable=true — first_seen=wave-2
[blocking] formatter rejects multi-line JSON array key when single-line representation fits within line width — auto_fixable=true — first_seen=wave-2
[medium] integration vitest project missing single-fork pool option that test-layout.md mandates for testcontainers reuse — auto_fixable=true — first_seen=wave-2
[medium] vitest config has empty include glob without passWithNoTests option; recursive test command fails on package with no tests — auto_fixable=true — first_seen=wave-2
[low] per-package lint script scopes diverge across workspace packages (src vs src+test) without documented convention — auto_fixable=false — first_seen=wave-2
[low] manifest scripts reference forward-declared dist artifacts and tooling that downstream tasks will create — auto_fixable=false — first_seen=wave-2
[medium] same-named branded identifier defined twice with incompatible brand strategies across contracts and api shared utils — auto_fixable=false — first_seen=wave-3
[low] shared env module evaluates its parsing factory at module-load time, eagerly coupling every transitive importer to a fully-populated process environment — auto_fixable=false — first_seen=wave-3
[medium] singleton-pool close helper does not accept the DI-injected pool, so factory-driven callers cannot dispose their own pool via the same lifecycle entrypoint — auto_fixable=false — first_seen=wave-4
[low] JWT sign/verify accept arbitrary secret strings without re-checking the minimum-length invariant enforced only at env boundary — auto_fixable=false — first_seen=wave-4
[medium] planner task verification.build is empty despite changes touching non-test source; TS compile errors surface only at terminal smoke wave — auto_fixable=false — first_seen=wave-4
[low] drizzle-kit config silently falls back to empty connection URL when env var is unset instead of failing fast at CLI invocation — auto_fixable=false — first_seen=wave-4
[low] crypto hash helper marked async but performs only synchronous work; Promise wrapper adds no value over synchronous return — auto_fixable=false — first_seen=wave-4
[medium] request-id header set after await next() so error responses constructed by onError lose the correlation header — auto_fixable=true — first_seen=wave-5
[medium] error handler logs unknown errors only when a request-scoped logger is present; missing logger middleware silently swallows 500s — auto_fixable=false — first_seen=wave-5
[medium] enum-like text column declared without drizzle enum option so TS column type widens to string and loses the literal-union narrowing the DB CHECK enforces — auto_fixable=false — first_seen=wave-5
[low] state-changing-methods set widened beyond architecture spec without documented justification — auto_fixable=true — first_seen=wave-5
[low] per-request child logger constructed twice instead of branching on userId presence — auto_fixable=false — first_seen=wave-5
[blocking] tsconfig rootDir excludes test/ tree while include matches it; first test files created cause TS6059 every typecheck — auto_fixable=false — first_seen=wave-6
[blocking] seeded plaintext password literal duplicated across seed script and test-support module with divergent values — auto_fixable=true — first_seen=wave-6
[medium] seeded-user emails diverge between docker seed script and integration-test fixture inserts; harness cannot exercise the real seed — auto_fixable=false — first_seen=wave-6
[medium] log-capture harness hardcodes redaction path list instead of sharing the production logger's redact config, so prod and tests can drift silently — auto_fixable=false — first_seen=wave-6
[medium] one-shot seed has a baked-in default password literal instead of failing fast when the env override is absent in non-dev environments — auto_fixable=false — first_seen=wave-6
[low] soft-delete filter applied in application code after the SELECT instead of in the SQL where clause — auto_fixable=true — first_seen=wave-6
[low] one-shot script uses console for output instead of pino, breaking structured-JSON log convention for the container that runs it — auto_fixable=false — first_seen=wave-6
[low] fluent builder method called for its side effect with return value discarded, brittle to library version changes — auto_fixable=true — first_seen=wave-6
[high] runtime container image runs as root; no non-root USER directive in final stage — auto_fixable=false — first_seen=wave-7
[medium] runtime container image copies node_modules from dev-deps stage; ships devDependencies into production image — auto_fixable=false — first_seen=wave-7
[low] container entrypoint command duplicated between compose service definition and image CMD; drift risk if one changes — auto_fixable=true — first_seen=wave-7
[low] package manager version pinned only inside Dockerfile (corepack) without matching root packageManager field; host/image parity not enforced — auto_fixable=false — first_seen=wave-7
[blocking] route handler returns raw DB row instead of parsing through response contract schema; passwordHash and timestamps leak into JSON response — auto_fixable=true — first_seen=wave-8
[low] test file defines dead helper factory bypassed by a near-identical adjacent factory — auto_fixable=true — first_seen=wave-8
[low] Hono context get without typed Variables generic, requiring inline `as` casts at every read site — auto_fixable=false — first_seen=wave-8
[low] logout handler invokes hash + DB rotate on missing cookie value instead of short-circuiting — auto_fixable=false — first_seen=wave-8
[medium] app-factory function accepts an env parameter but ignores it; integration tests cannot inject test-scoped configuration without going through the import-time singleton — auto_fixable=false — first_seen=wave-9
[low] application entry point relies on transitive import side effects to instantiate the database pool instead of constructing it explicitly in main — auto_fixable=false — first_seen=wave-9
[low] underscore-prefixed local identifier convention applied to symbols that are subsequently read, diluting the "intentionally unused" signal — auto_fixable=true — first_seen=wave-9
[blocking] global csrf+authn middleware composed before route handlers, so per-route public-route flag set inside the body never reaches the upstream gate; bootstrap routes unreachable through the production app factory — auto_fixable=false — first_seen=wave-10
[high] integration tests construct their own router-only app instead of exercising the production app factory, masking middleware-composition defects from the test gate — auto_fixable=false — first_seen=wave-10
[low] integration test factory accepts a logger parameter that is never read inside the function body — auto_fixable=true — first_seen=wave-10
[low] adversarial-boot test exercises the env-validation helper directly instead of the app entrypoint named in the task spec — auto_fixable=false — first_seen=wave-10
[low] per-file test repo factory duplicated verbatim across multiple integration test files instead of shared via support module — auto_fixable=false — first_seen=wave-10
[blocking] stale compiled .js/.d.ts artifacts under test tree pollute lint discovery and vitest globs; root cause is composite tsconfig emitting test outputs that .gitignore does not cover — auto_fixable=true — first_seen=wave-smoke
[high] biome files.ignore list omits planner-tool directory (.relay/**) and compiled test artifacts; lint gate fails on out-of-source manifests and emit byproducts — auto_fixable=true — first_seen=wave-smoke
[medium] testcontainers pg-per-file harness with withReuse() races migrations across vitest workers, producing pg_extension/pg_type duplicate-key errors — auto_fixable=false — first_seen=wave-smoke
[medium] verification-only smoke task with max_attempts:1 and no preceding hygiene wave; mechanical drift discovered at terminal gate has no auto-fix path — auto_fixable=false — first_seen=wave-smoke
