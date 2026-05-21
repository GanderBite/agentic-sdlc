# task-workspace-root — blocked

**Wave:** wave-1
**Attempt:** 1 (infra-builder)
**Verdict:** partial

## What landed

All nine target files exist and the substantive verification passes:
- `package.json` — pins `"packageManager": "pnpm@10.11.0"`, recursive scripts, biome+typescript devDeps
- `tsconfig.base.json` — `strict: true`, ESNext, NodeNext module/moduleResolution
- `biome.json` — recommended rules, project-pinned overrides
- `.npmrc`, `.env.example`, `.dockerignore` — per spec
- `pnpm-workspace.yaml`, `.gitignore` — preserved/extended pre-existing files
- `pnpm-lock.yaml` — generated; `pnpm install --frozen-lockfile` exits 0
- Custom checks 1 (`"strict": true` in tsconfig) and 2 (`packages:` in workspace yaml) pass

## Why blocked

`verification.custom[0]` is a malformed regex in the task spec:

```
rg --quiet "^packageManager\":\s*\"pnpm@10" package.json
```

The pattern anchors `packageManager` to start-of-line without a leading `"`,
but JSON formatting always emits `  "packageManager": "pnpm@10.x"` with
leading whitespace + opening quote. The regex cannot match valid JSON.

The correct spec would be `^\s*"packageManager":\s*"pnpm@10`. This is a
verification-spec defect, not a code defect — the substantive value
`"packageManager": "pnpm@10.11.0"` is correct in `package.json`.

## Resolution path

The post-wave `review-fix-loop` (sprint-level auto-fixer) should either:
1. Patch the regex in `.planning/sprints/sprint-001.tasks.json` (custom[0] of `task-workspace-root.verification.custom`), OR
2. Re-evaluate manually since the actual artifact is correct.

Wave-runner cannot edit code/specs directly per invariants.
