<!-- version: 1.0.0 -->
# Output templates — annotated examples

Cut-and-paste skeletons for `review-{wave_id}.json` and `findings-{wave_id}.json`. Keep these in lockstep with `SKILL.md` "Schemas" — `scripts/validate-review.mjs` is the source of truth for what passes.

---

## Template 1 — happy path (Phase 1 + Phase 2, all green)

`review-wave-2.json`:
```json
{
  "wave_id": "wave-2",
  "tasks": [
    {
      "task_id": "task-9c1b",
      "gates": [
        { "kind": "tests",       "cmd": "pnpm test --filter resource",  "exit": 0, "duration_ms": 5102, "flake_retries": 0 },
        { "kind": "lint",        "cmd": "pnpm lint --filter resource",  "exit": 0, "duration_ms": 612,  "flake_retries": 0 },
        { "kind": "build",       "cmd": "pnpm build --filter resource", "exit": 0, "duration_ms": 1890, "flake_retries": 0 },
        { "kind": "files_exist", "cmd": "src/modules/resource/audit-log.ts", "exit": 0, "duration_ms": 1, "flake_retries": 0 },
        { "kind": "custom",      "cmd": "rg --quiet 'auditLog' src/modules/resource/resource.service.ts", "exit": 0, "duration_ms": 38, "flake_retries": 0 }
      ],
      "verdict": "pass"
    }
  ],
  "verdict": "pass"
}
```

`findings-wave-2.json`:
```json
{ "wave_id": "wave-2", "findings": [] }
```

Empty `findings` is a valid output. Do NOT manufacture findings to look thorough.

---

## Template 2 — flake-retry rescue on the tests gate

```json
{
  "wave_id": "wave-3",
  "tasks": [
    {
      "task_id": "task-3e8d",
      "gates": [
        { "kind": "tests", "cmd": "pnpm test --filter realtime", "exit": 0, "duration_ms": 12450, "flake_retries": 1 },
        { "kind": "lint",  "cmd": "pnpm lint --filter realtime",  "exit": 0, "duration_ms": 540,   "flake_retries": 0 }
      ],
      "verdict": "pass",
      "flaky": true
    }
  ],
  "verdict": "pass"
}
```

Notes:
- `flake_retries: 1` means the command was re-run once and passed.
- `duration_ms` is the SUM across attempts (R3.4 implication).
- `flaky: true` on the task surfaces in the PR body.
- The retry was permitted because (a) `kind: tests`, (b) `verification_failure_modes` listed `pnpm test --filter realtime` with `flake_rate > 0.02`. Without an entry, no retry runs.

---

## Template 3 — verification failure (no flake budget)

```json
{
  "wave_id": "wave-4",
  "tasks": [
    {
      "task_id": "task-1a4b",
      "gates": [
        { "kind": "tests", "cmd": "pnpm test --filter billing", "exit": 1, "duration_ms": 4801, "flake_retries": 0 },
        { "kind": "lint",  "cmd": "pnpm lint --filter billing",  "exit": 0, "duration_ms": 580,  "flake_retries": 0 }
      ],
      "verdict": "fail"
    }
  ],
  "verdict": "fail"
}
```

The wave-runner now applies `task.max_attempts` and `on_fail` (§9). The reviewer does not retry beyond the flake budget; deeper retry policy is the orchestrator's responsibility.

---

## Template 4 — `reviewer_overload` (the cap is exceeded)

You audited a wave and found 8 candidate `blocking` findings. R5.3 forbids emitting more than 5. Triage:

1. Sort candidates by impact (security exploit > broken contract > hard-boundary architecture > everything else).
2. Keep the top 5 as `blocking`.
3. The remainder either (a) demote to `high`, or (b) drop and summarize via a single `F-OVERFLOW` `info` finding.

`review-wave-5.json` (Phase 1 may still be green — verdict applies regardless):
```json
{
  "wave_id": "wave-5",
  "tasks": [
    { "task_id": "task-aa11", "gates": [ /* ... */ ], "verdict": "pass" }
  ],
  "verdict": "reviewer_overload"
}
```

`findings-wave-5.json`:
```json
{
  "wave_id": "wave-5",
  "findings": [
    { "id": "F-001", "severity": "blocking", "category": "security",     "file": "src/auth/login.ts",     "line": 42, "summary": "SQL injection in login handler via unsanitized email", "suggested_fix": "Use parameterized query: db.query('SELECT * FROM users WHERE email = ?', [email])", "auto_fixable": true },
    { "id": "F-002", "severity": "blocking", "category": "security",     "file": "src/auth/reset.ts",     "line": 17, "summary": "Reset token uses Math.random() instead of crypto.randomBytes",       "suggested_fix": "Replace Math.random() with crypto.randomBytes(32).toString('hex')",                "auto_fixable": true },
    { "id": "F-003", "severity": "blocking", "category": "architecture", "file": "src/domain/user.ts",    "line": 88, "summary": "Domain layer imports from infrastructure (forbidden by ARCHITECTURE.md §3.2)", "suggested_fix": "Inject UserRepository via constructor; remove `import {db} from '../infra/db'`",   "auto_fixable": false },
    { "id": "F-004", "severity": "blocking", "category": "security",     "file": "src/api/admin.ts",      "line": 5,  "summary": "Admin endpoint missing authorization middleware",                              "suggested_fix": "Wrap router with requireRole('admin') as adjacent admin routes do",               "auto_fixable": true },
    { "id": "F-005", "severity": "blocking", "category": "security",     "file": "src/config/app.ts",     "line": 12, "summary": "Hardcoded JWT secret committed",                                              "suggested_fix": "Load from process.env.JWT_SECRET; remove the literal; rotate the leaked value",   "auto_fixable": false },
    { "id": "F-006", "severity": "high",     "category": "performance",  "file": "src/modules/feed.ts",   "line": 73, "summary": "N+1 query in feed pagination (was a 6th candidate blocking; demoted)",         "suggested_fix": "Batch with .findMany({ where: { id: { in: ids } } })",                            "auto_fixable": true },
    { "id": "F-007", "severity": "high",     "category": "security",     "file": "src/api/upload.ts",     "line": 9,  "summary": "Missing rate-limit on costly endpoint (was a 7th candidate blocking; demoted)", "suggested_fix": "Apply rateLimit({ window: '1m', max: 10 }) middleware",                            "auto_fixable": true },
    { "id": "F-OVERFLOW", "severity": "info", "category": "architecture", "file": ".planning/sprints/sprint-001/findings-wave-5.json", "line": 1, "summary": "1 additional blocking-candidate finding dropped due to 5-blocking cap", "suggested_fix": "Re-spawn reviewer after orchestrator fixes the top 5; remaining issue is duplicated 80-line auth helper at src/auth/util.ts", "auto_fixable": false }
  ]
}
```

The validator (`scripts/validate-review.mjs`) accepts this: 5 blocking exactly, all enums valid, all files exist, all required fields present. The wave-runner sees `verdict: "reviewer_overload"` and follows §10.4 — re-prompt or escalate.

---

## Template 5 — smoke wave output

The smoke wave runs the full `build-graph.smoke` array. The Phase 1 output looks the same as a normal wave; Phase 2's `changed_files` spans the entire sprint, so findings counts are typically higher and the blocking cap matters more.

```json
{
  "wave_id": "wave-smoke",
  "tasks": [
    {
      "task_id": "task-smoke",
      "gates": [
        { "kind": "tests", "cmd": "pnpm test",  "exit": 0, "duration_ms": 41200, "flake_retries": 0 },
        { "kind": "build", "cmd": "pnpm build", "exit": 0, "duration_ms": 18900, "flake_retries": 0 },
        { "kind": "lint",  "cmd": "pnpm lint",  "exit": 0, "duration_ms": 3210,  "flake_retries": 0 }
      ],
      "verdict": "pass"
    }
  ],
  "verdict": "pass"
}
```

A green smoke wave is the only thing that lets the sprint produce a non-blocked PR (§10.5). If smoke is `fail`, the wave-runner blocks the sprint regardless of upstream waves passing.

---

## Output paths

- Default: `.planning/sprints/<sprint_id>/review-{wave_id}.json` and `findings-{wave_id}.json`.
- The wave-runner spawn prompt may override; honor the explicit path if given.
- `Write` tool preferred. If unavailable, use `Bash`: `cat > <path> <<'EOF' ... EOF`.
- Always atomic-write: write to `.tmp` then rename, OR rely on the Bash heredoc + the surrounding orchestrator's wave-runner reading after your Task returns.
