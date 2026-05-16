# biome — rule selection reference

This document explains the Biome 1.9 rule selection for MedBridge: what `recommended` covers, which rules MedBridge pins above recommended, justified overrides, and rules considered but explicitly rejected.

## 1. What `"recommended": true` enables

Biome's recommended set is a curated subset of all rules, scoped roughly to bugs and broadly-agreed style. It is grouped into eight categories that map to severity:

- `a11y` — accessibility checks for JSX/HTML attributes (alt text, ARIA usage, valid roles, label-for).
- `complexity` — code-smell reducers (`useFlatMap`, `useOptionalChain`, `noStaticOnlyClass`, `noUselessCatch`).
- `correctness` — likely-bug detectors (`noUnreachable`, `noUndeclaredVariables`, `useExhaustiveDependencies` for React hooks, `noConstAssign`).
- `performance` — flagged anti-patterns (`noAccumulatingSpread`, `noDelete`).
- `security` — `noDangerouslySetInnerHtml`, `noGlobalEval`.
- `style` — naming + idioms (`useConst`, `useTemplate`, `noNonNullAssertion`, `useShorthandArrayType`).
- `suspicious` — likely-bug patterns (`noConsoleLog`, `noDebugger`, `noDoubleEquals`, `noExplicitAny` at "warn" level by default).
- `nursery` — experimental rules; Biome may promote them on minor bumps. Treat all `nursery` rules as opt-in.

The exact membership of recommended changes across Biome versions. MedBridge pins `^1.9.x`; do not let Renovate float to `1.10.x` without a review pass over diff'd recommended membership.

## 2. MedBridge-pinned rules (above recommended)

These three rules are pinned to `error` regardless of recommended-set membership:

### 2.1 `correctness/noUnusedImports: "error"`

In recommended at "warn" in 1.9. MedBridge promotes to "error" so unused imports cannot land. Pairs with `organizeImports.enabled: true`, which sorts and dedupes imports on `--write`.

### 2.2 `style/useImportType: "error"`

Forces type-only imports to use the `import type { … }` form. This:

- Prevents the imported binding from being emitted in the JS output (matters for `apps/api`'s `tsc --noEmit false` pipeline — see `typescript` skill).
- Avoids accidental side-effect imports when only the type is needed.
- Matches `tsconfig.json`'s `verbatimModuleSyntax: true` setting (planned per `docs/TECH_STACK.md`).

### 2.3 `suspicious/noExplicitAny: "error"`

In recommended at "warn" in 1.9. MedBridge promotes to "error" — `any` is forbidden across the codebase (cross-references the `typescript` skill rule: use `unknown` and narrow). The only escape hatch is the `overrides` entry for test fixtures documented below.

## 3. Justified `overrides`

### 3.1 Test fixtures may use `any`

```jsonc
{
  "include": ["**/*.test.ts", "**/*.test.tsx", "**/test-utils/**"],
  "linter": { "rules": { "suspicious": { "noExplicitAny": "off" } } }
}
```

**Reason:** test fixtures construct intentionally malformed inputs to verify error paths; forcing `unknown` + narrowing in fixtures is busywork that obscures the test intent. `apps/*/src/**` (non-test) MUST keep `noExplicitAny` at "error".

### 3.2 Generated SQL types

Drizzle Kit emits a `.drizzle/` cache of intermediate metadata. It is not source; it's ignored at the `files.ignore` level rather than via an override.

## 4. Rules considered and rejected

### 4.1 `style/useNamingConvention`

Rejected for now. Biome's naming-convention rule is opinionated about camelCase boundaries that clash with the contracts package (Zod schemas often mirror snake_case DB columns). Revisit once Biome supports per-property identifier patterns.

### 4.2 `nursery/noRestrictedImports` for boundary enforcement

Rejected. See SKILL.md Rule 23: cross-workspace import boundaries are owned by `scripts/check-boundaries.ts`, which uses TypeScript's compiler API to walk the module graph. `noRestrictedImports` only matches literal specifiers, which is too weak for the `apps/api` <-> `packages/contracts` directional rule.

### 4.3 `complexity/noForEach`

Rejected. The performance argument is negligible for MedBridge's data sizes; the diff churn from converting existing `.forEach` to `for…of` is not worth it.

## 5. Bumping Biome

When the renovate bot proposes a Biome bump:

1. Run `pnpm exec biome migrate` in a scratch branch — it rewrites `biome.json` to match new field names if any.
2. Diff `biome.json` and the recommended-set changelog. New rules in `recommended` may produce diagnostics across existing code.
3. Run `pnpm -r lint` against `main`'s code with the bumped Biome.
4. Either fix violations in the same PR or temporarily set the new rule to `"off"` with a TODO comment and a tracking issue.

Major version bumps (1.x → 2.x) require a coordinated wave plan — never auto-merge.
