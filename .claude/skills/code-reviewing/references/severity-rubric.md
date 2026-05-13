<!-- version: 1.0.0 -->
# Severity rubric — when X becomes blocking vs high vs medium vs low vs info

The five-tier severity scale (`blocking | high | medium | low | info`) is a closed set defined in AGENTIC_SDLC.md §10.2. The five categories (`security | architecture | performance | duplication | style`) are also closed. This file is the authoritative tiebreaker the reviewer consults when assigning severity.

The cardinal rule for **`blocking`**: a finding is `blocking` only if **shipping the wave with this finding present would either break a downstream wave, ship an exploitable defect, or violate a hard rule the team has explicitly committed to** (encoded in `ARCHITECTURE.md`, the contract artifacts of §5.4, or the security policy). Anything looser is at most `high`.

The cardinal rule for **`info`**: never emit `info` for a real bug. `info` is reserved for *signals to the planner / human* (scope drift, missing docs, naming inconsistencies). If a reader of `info` would say "this is a real problem", you assigned the wrong severity.

The blocking cap is 5 per wave (R5.3). When in doubt between `blocking` and `high`, choose `high`. The orchestrator can spawn a builder fix or escalate based on the `auto_fixable` flag for `high`+ findings if it later promotes them; under-calling a `blocking` is recoverable, over-calling triggers `reviewer_overload`.

---

## category: security

| Severity   | Trigger |
|------------|---------|
| blocking   | Exploitable issue: SQL/NoSQL injection, XSS, SSRF, command injection, auth bypass, IDOR on a sensitive resource, broken cryptography on user data, hardcoded secrets/credentials/keys, missing authorization on a privileged endpoint, secret in commit. |
| high       | Likely-exploitable-but-bounded: weak input validation on a non-public path, time-of-check/time-of-use that requires unusual conditions, missing rate-limit on a costly endpoint, sensitive data in plaintext logs, CORS misconfiguration, weak password/hash policy in code being added (not in pre-existing code). |
| medium     | Defense-in-depth gaps: missing CSRF token on a non-state-changing endpoint, overly broad error messages leaking stack traces in non-prod, dependency at a version with known low-severity CVE. |
| low        | Hardening misses with no plausible exploit path: hardcoded TODO("set timeout"), nonstandard but functional crypto API choice. |
| info       | Reserved for `architecture_doc_missing` and similar signals. Do not put real security findings here. |

**Heuristic**: if you can describe an attacker's first three steps to exploit it on the changed code as written, it is `blocking`. If the attacker needs an unusual precondition that the codebase doesn't provide, it is `high`.

---

## category: architecture

| Severity   | Trigger |
|------------|---------|
| blocking   | Hard-boundary violation explicitly forbidden by `ARCHITECTURE.md` (e.g. "domain layer must never import from infrastructure"; the new code does that). Broken contract: edited code violates a frozen contract artifact under `.planning/sprints/*/contracts/`. New cyclic module dependency the build will reject (or did reject — caught by Phase 1, but still record here for the planner's hint). |
| high       | Soft-boundary violation: `ARCHITECTURE.md` documents a convention (not a hard rule) and the change crosses it. New cross-module dependency that bypasses an existing facade. Public API surface widened without an interface update. |
| medium     | Pattern drift: new module duplicates a structural pattern (controller/service/repo split) inconsistently with peers. Non-obvious side effect added to a previously-pure function. |
| low        | Layering nit: utility added in a generic location that should live in a feature module. |
| info       | **Scope drift** (file edited outside `target_files.{create,update,may_also_touch}`) — always `info`, always `category: architecture`. Pattern: `Edited outside task target_files; not declared in may_also_touch`. Also: `architecture_doc_missing`. |

**Heuristic**: blocking architecture findings reference an *explicit* rule by section number. If you can't cite ARCHITECTURE.md §X or a contract path, drop to `high`.

---

## category: performance

| Severity   | Trigger |
|------------|---------|
| blocking   | Algorithmic regression on a known-hot path with measurable proof in this PR (benchmark file, comment in code, or PR description). Unbounded resource consumption (no pagination on a query the spec says will exceed 10k rows; in-memory accumulation of an unbounded stream). |
| high       | N+1 query on a known-large collection. Synchronous I/O on a request path that documents a p95 budget. Missing index on a column added to a `WHERE` clause. Memory leak in a long-running process. |
| medium     | Suboptimal complexity in a non-hot path (O(n²) on a list of plausible size 100). Unnecessary serialization round-trip. Cache TTL set without justification. |
| low        | Micro-inefficiency: extra Array.from() copy, redundant JSON.stringify in a log line. |
| info       | Reserved. Do not use for performance findings. |

**Heuristic**: blocking requires evidence of impact, not just suspicion. Without a hot-files signal (from `.planning/intel/hot-files.md`) or a documented budget, drop to `high`.

---

## category: duplication

| Severity   | Trigger |
|------------|---------|
| blocking   | Reserved. Duplication alone almost never blocks a wave; if it does, recategorize as `architecture` (broken contract). |
| high       | New duplicate of >50 lines of logic, where the original is a clearly-canonical implementation in the codebase (e.g., the existing `auth/middleware.ts` is being re-implemented). Indicates the builder did not read its skills. |
| medium     | New duplicate of 20–50 lines OR new code repeats a recognizable pattern that has a utility helper elsewhere in the codebase. |
| low        | Small duplication (<20 lines) that would be cleaner extracted but is not load-bearing. |
| info       | Reserved. Do not use for duplication findings. |

**Heuristic**: count physical lines and search the codebase with Grep. Without a near-identical block elsewhere, downgrade.

---

## category: style

| Severity   | Trigger |
|------------|---------|
| blocking   | Reserved. Style is never blocking. If you want to block, recategorize. |
| high       | Reserved. Style alone is rarely high-severity. The exception: a documented `conventions.md` rule explicitly violated in a load-bearing way. |
| medium     | Conventions.md violation: naming, layering, error-handling pattern, or logging style demonstrably broken. |
| low        | Inconsistency with adjacent code: comment style, import order, minor formatter drift. |
| info       | Naming nit, missing JSDoc on a non-public symbol, file unreadable (R4.5). |

**Heuristic**: lint usually catches style. If lint passes (Phase 1 gate is green) and you still want a style finding, you are second-guessing the linter — keep it `low` or drop it.

---

## Cross-cutting heuristics

1. **Same finding, multiple categories** — pick the one closest to the *root cause*. A SQL injection in a layer that also crosses an architecture boundary is `security/blocking`, not `architecture/blocking`.
2. **Multiple findings, same root cause** — emit one finding with the highest-severity description; mention the sister occurrences in `suggested_fix`.
3. **`auto_fixable: true` checklist** — the fix must be (a) a known-shape mechanical edit (replace literal X with literal Y, add a missing `await`, add a known import, add a `null` check on a known field), and (b) verifiable by the existing `task.verification` block. If a fix requires design judgement, `auto_fixable: false`.
4. **The 5-blocking cap is a forcing function**, not a target. A wave with zero blocking findings is the normal case. If you regularly hit 4–5, the builders are not reading their skills (see §21.3).
