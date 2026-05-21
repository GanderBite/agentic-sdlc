# do-not-recur — sprint-001

One line per non-info finding. Pattern descriptions only — no tool-specific syntax. Read by subsequent task-builders in this sprint and by the planner of the next sprint.

[medium] verification regex omits leading whitespace + opening quote when matching indented JSON keys — auto_fixable=true — first_seen=wave-1
[low] root scripts diverge from planner-specified `-r` recursive form without explicit convention update — auto_fixable=false — first_seen=wave-1
[low] root scripts reference helper files that do not exist yet (forward-references to later waves) — auto_fixable=false — first_seen=wave-1
[low] root package.json missing engines.node field despite tech stack pinning a specific Node major — auto_fixable=false — first_seen=wave-1
[blocking] lockfile not regenerated after new workspace package manifests added; frozen-install gate fails — auto_fixable=true — first_seen=wave-2
[blocking] formatter rejects multi-line JSON array key when single-line representation fits within line width — auto_fixable=true — first_seen=wave-2
[medium] integration vitest project missing single-fork pool option that test-layout.md mandates for testcontainers reuse — auto_fixable=true — first_seen=wave-2
[medium] vitest config has empty include glob without passWithNoTests option; recursive test command fails on package with no tests — auto_fixable=true — first_seen=wave-2
[low] per-package lint script scopes diverge across workspace packages (src vs src+test) without documented convention — auto_fixable=false — first_seen=wave-2
