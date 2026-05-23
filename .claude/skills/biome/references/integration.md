# biome — integration reference

How Biome is wired into MedBridge's pre-commit hook, CI pipeline, and editor configuration.

## 1. Pre-commit hook (`simple-git-hooks` + `lint-staged`)

MedBridge runs `biome check --write` against staged files on every commit. Two tools, both installed at the repo root:

- **`simple-git-hooks`** — installs the `.git/hooks/pre-commit` script declared in `package.json`.
- **`lint-staged`** — given a staged file list, runs commands scoped to those files and re-stages the results.

### 1.1 Root `package.json` snippet

```json
{
  "scripts": {
    "prepare": "simple-git-hooks"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm exec lint-staged"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,jsonc}": "biome check --write --no-errors-on-unmatched"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "simple-git-hooks": "^2.11.0",
    "lint-staged": "^15.2.0"
  }
}
```

### 1.2 Install

```bash
pnpm install                 # postinstall (`prepare`) wires the hook
ls -la .git/hooks/pre-commit # confirm it exists, points at lint-staged
```

If a contributor's hook is missing (e.g. clone with `--no-tags --filter=blob:none` or installed before adding the script), re-run `pnpm exec simple-git-hooks`.

### 1.3 Flow on `git commit`

1. `git commit` triggers `.git/hooks/pre-commit`.
2. Hook runs `pnpm exec lint-staged`.
3. `lint-staged` builds the staged file list and invokes `biome check --write --no-errors-on-unmatched <files>`.
4. Biome mutates files in place; `lint-staged` re-stages the modified files with `git add`.
5. If Biome exits non-zero (lint diagnostics with no auto-fix available), the commit aborts.

### 1.4 Bypass (manual only)

```bash
git commit --no-verify       # skips simple-git-hooks
```

Never use `--no-verify` in scripts, CI, or bots. The `version-control` skill rule on this is the canonical source.

## 2. CI wiring (GitHub Actions)

MedBridge has a single workflow at `.github/workflows/ci.yml`. The lint step is one line; Biome is invoked through `pnpm -r lint`, never directly.

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 25, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r lint                # ← Biome
      - run: pnpm check-boundaries       # ← separate gate
      - run: pnpm -r typecheck
      - run: pnpm -r test
```

Notes:

- The order is fixed by the `pnpm` skill (Rule 13 there). Do not reorder.
- `pnpm -r lint` propagates Biome's exit code; a `1` from any workspace fails the job.
- The boundary check is a separate `run:` line because it's a separate tool with its own diagnostics.

## 3. Editor integration (VS Code)

### 3.1 Extension

Install `biomejs.biome` (the official Biome extension). Recommend it via `.vscode/extensions.json`:

```json
{
  "recommendations": ["biomejs.biome"]
}
```

### 3.2 `.vscode/settings.json` (repo-level, committed)

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "[typescript]":      { "editor.defaultFormatter": "biomejs.biome" },
  "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[javascript]":      { "editor.defaultFormatter": "biomejs.biome" },
  "[json]":            { "editor.defaultFormatter": "biomejs.biome" },
  "[jsonc]":           { "editor.defaultFormatter": "biomejs.biome" }
}
```

Explicitly setting the per-language formatter prevents Prettier (if a user has it installed globally) from re-claiming `.json`/`.jsonc`.

### 3.3 What the extension picks up

The extension reads `biome.json` from the repo root. Settings drift between editor and CLI is impossible because both read the same config — that is one of the explicit reasons MedBridge chose Biome over ESLint + Prettier.

## 4. Other editors

- **JetBrains / WebStorm** — official Biome plugin in the marketplace; same `biome.json` source of truth.
- **Neovim** — `nvim-lspconfig` ships a `biome` server config; or use `conform.nvim` for format-on-save.
- **Helix** — Biome supports LSP; configure as a language server in `languages.toml`.

Any editor that speaks LSP works. We do not maintain editor-specific docs beyond VS Code, which is the team default.

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Configuration error: file not found "biome.json"` | Running from a subdirectory without a config or a missing root config. | Run from repo root, or pass `--config-path=<root>/biome.json`. |
| `biome.json: unknown field` | Biome version bump renamed a field. | Run `pnpm exec biome migrate`. |
| Pre-commit hangs on huge commits | Biome processes thousands of files. | Confirm `lint-staged` is scoping; if so, the commit is genuinely huge — split it. |
| `editor.defaultFormatter` resets to Prettier | Another extension claimed the language. | Re-add the explicit `[typescript]` etc. blocks above; commit `.vscode/settings.json`. |
| `biome` not found at hook time | `node_modules` not installed or PATH issue in GUI git clients. | `pnpm install` from the terminal at least once; GUI clients inherit shell PATH only after that. |
