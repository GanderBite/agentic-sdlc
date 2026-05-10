# Estimation reference

The token-cost model the planner uses to pick `task.estimate_tokens` and to size waves and sprints.

## Formula (from §5.5)

```
final_estimate = base_estimate
                 × geomean(skill_multipliers[s] for s in task.skills)
                 × model_multipliers[task.model]
                 × kind_multipliers[task.kind]
```

Where:

- `base_estimate` is built from cold-start primitives (below).
- All multipliers come from `.planning/estimation_priors.json`.
- A multiplier is **trusted only when its `n ≥ 5`**. If `n < 5`, substitute `1.0` for that factor. This prevents single-sample noise from dominating early sprints.
- `mean_ratio = actual_tokens / estimated_tokens`. `>1` means the planner under-estimates and the multiplier pushes the next estimate up.

## Cold-start primitives (§15.2)

These give a `base_estimate` before priors exist. They are deliberately simple — refinement comes from priors after the calibration sprint.

| Operation | Tokens |
|---|---|
| Read 1 file | `tokens(file) ≈ chars(file) / 4` |
| Partial edit of an existing file | `0.3 × tokens(file)` |
| Create a brand-new file | `1.0 × tokens(target_size_estimate)` |
| Run a verification gate | ≈ 1k tokens (agent reads result, not gate output unless failed) |
| Skill load | `INDEX.json[<skill>].size_tokens` |
| Spawn one Task subagent | ≈ 2k tokens of orchestrator overhead |

### Worked example — base_estimate for a single task

Task: `extend_module`, touches 1 existing 800-line service file (~3200 tokens) + 1 new 200-line file, runs `tests + lint + build + 1 custom`. Skills: `typescript` (3200 tokens), `prisma` (2800 tokens). Model: sonnet.

```
reads      = 3200 (existing service)
              + 1200 (model file the builder also Reads)
              = 4400
edits      = 0.3 × 3200  (partial edit of service)         = 960
new_file   = 1.0 × 800   (200 lines × ~4 tokens/line)      = 800
gates      = 4 × 1000                                      = 4000
skills     = 3200 + 2800                                   = 6000
spawn      = 2000 (orchestrator overhead, only for context)
prose_buf  = 2000 (description, summary, scratchpad)

base_estimate ≈ reads + edits + new_file + gates + skills + prose_buf
              = 4400 + 960 + 800 + 4000 + 6000 + 2000
              = 18,160 ≈ 18k
```

Round to `18000`. The `spawn` primitive is for orchestrator accounting (in `wave-runner` budgets), not for the per-task `estimate_tokens`.

### Apply priors

If `estimation_priors.json` has trusted entries:

```
typescript: mean_ratio=1.05, n=42        → trusted
prisma:     mean_ratio=1.45, n=12        → trusted
sonnet:     mean_ratio=1.00, n=80        → trusted
extend_module: mean_ratio=1.05, n=47     → trusted
```

```
geomean(skill) = sqrt(1.05 × 1.45) ≈ 1.234
final_estimate = 18000 × 1.234 × 1.00 × 1.05
              ≈ 23,322 → round to 23000
```

If `prisma` had `n=3` (not yet trusted), substitute 1.0:

```
geomean(skill) = sqrt(1.05 × 1.0) ≈ 1.025
final_estimate = 18000 × 1.025 × 1.00 × 1.05 ≈ 19,372 → 19000
```

## Default budgets (§15.1)

| Scope | Target | Hard cap |
|---|---|---|
| Single builder task | 25k | 50k |
| Single wave (Σ across builders) | 200k | — |
| Wave-runner orchestrator (separate from builder sum) | 80k | — |
| Sprint orchestrator | 150k | — |
| Sprint total (orch + builders + reviewer) | tracked, no hard cap | informs splitting |

If a single task estimates above the 50k hard cap, split it.

## Model selection (model_multipliers consumer)

Pick `task.model` deterministically per the §5.1.1 rule before applying multipliers:

| Condition | Model |
|---|---|
| Touches >5 files OR new architecture/security/data-schema decision | `opus` |
| Pure rename / config edit / doc-only with no logic | `haiku` |
| Otherwise (the common case) | `sonnet` |

Then apply `model_multipliers[task.model]` to the formula.

## Kind selection (kind_multipliers consumer)

`task.kind` is one of: `new_module | extend_module | rename | test_only`. Pick by inspecting `target_files`:

| Heuristic | Kind |
|---|---|
| `target_files.create` adds a top-level module dir/package | `new_module` |
| Edits within an existing module dir | `extend_module` |
| Pure rename (no logic change; `update` is mostly identifier swaps) | `rename` |
| Only `__tests__/` paths in `target_files` | `test_only` |

If multiple match, pick the largest-multiplier match (most pessimistic) to avoid under-estimation.

## Trust threshold

The `n ≥ 5` rule is non-negotiable. Without it, the calibration sprint (§21.2) would seed `mean_ratio` with a single observation and bias every subsequent plan. The calibration sprint is intentionally sized to push the dominant skills past `n = 5`.

If a multiplier exists but is untrusted, log it in the planner's coverage report so retros can prioritize accumulating data on under-sampled skills.

## Patch flow (don't write priors directly)

The planner READS `estimation_priors.json`. It NEVER writes it. Updates flow:

1. Sprint completes → reviewer reads `task.actuals.tokens_used` per task.
2. Reviewer emits `.planning/retros/sprint-<id>.priors-patch.json` (delta_n, delta_ratio_sum per multiplier).
3. `scripts/merge-priors.mjs` folds the patch into `estimation_priors.json` deterministically (running mean, stddev, n).
4. The next planner run reads the updated priors.

The LLM never directly rewrites priors. This is what makes estimation reproducible across re-runs.

## Wave invariant hints (§11.3)

`estimation_priors.json.wave_invariant_hints` is the planner's other learning surface. Each hint is `{pattern, advice, evidence_sprints}`. After 3 sprints of evidence the hint is *enforced* by the plan validator (§19.2 / §11.3). The planner MUST satisfy enforced hints; merely "suggested" hints are advisory.

Read all hints on every plan run; apply enforced ones during wave grouping.

## Verification failure modes (§9.1)

`estimation_priors.json.verification_failure_modes` is consumed by the **reviewer**, not the planner. The planner does NOT adjust estimates based on flake rates — flakes are runtime concern, not estimation concern.
