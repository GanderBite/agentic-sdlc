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
