# Tailwind 4 `@theme` Token Reference

Tailwind 4 generates utilities directly from CSS custom properties declared in a `@theme` block. The variable's **namespace prefix** determines which utility families appear.

## Namespace → utility mapping

| Namespace            | Example variable             | Generated utilities (selection)                              |
|----------------------|------------------------------|--------------------------------------------------------------|
| `--color-*`          | `--color-brand-500`          | `bg-brand-500`, `text-brand-500`, `border-brand-500`, `ring-brand-500`, `fill-brand-500`, `stroke-brand-500`, `decoration-brand-500`, `outline-brand-500`, `caret-brand-500`, `accent-brand-500` |
| `--font-*`           | `--font-sans`, `--font-mono` | `font-sans`, `font-mono`                                     |
| `--spacing`          | `--spacing: 0.25rem`         | All spacing utilities (`p-*`, `m-*`, `gap-*`, `w-*`, `h-*`, `top-*`, `inset-*`, etc.) computed as `calc(var(--spacing) * <n>)` |
| `--radius-*`         | `--radius-md`                | `rounded-md`                                                 |
| `--breakpoint-*`     | `--breakpoint-md`            | `md:*` responsive variant; also exposes container queries via `@container md:*` |
| `--container-*`      | `--container-md`             | `max-w-md`, `min-w-md`, `w-md`                               |
| `--text-*`           | `--text-base`                | `text-base` (font-size + paired line-height)                 |
| `--leading-*`        | `--leading-tight`            | `leading-tight`                                              |
| `--tracking-*`       | `--tracking-wide`            | `tracking-wide`                                              |
| `--shadow-*`         | `--shadow-md`                | `shadow-md`, `drop-shadow-md`                                |
| `--inset-shadow-*`   | `--inset-shadow-sm`          | `inset-shadow-sm`                                            |
| `--blur-*`           | `--blur-md`                  | `blur-md`, `backdrop-blur-md`                                |
| `--animate-*`        | `--animate-spin-slow`        | `animate-spin-slow` (paired with a `@keyframes` block)       |
| `--ease-*`           | `--ease-snappy`              | `ease-snappy`                                                |
| `--aspect-*`         | `--aspect-video`             | `aspect-video`                                               |
| `--perspective-*`    | `--perspective-near`         | `perspective-near`                                           |

Full list at the cached source `references/tailwind-v4-docs.md` (TODO if needed). The names above match the v4 GA release as of 2026-05-14.

## Pairing tokens that generate one utility

Some utilities consume two related variables. Example:

```css
@theme {
  --text-base: 1rem;
  --text-base--line-height: 1.5rem;  /* paired property */
}
```

This makes `text-base` set both `font-size: 1rem` and `line-height: 1.5rem`.

The paired-property suffix pattern (`--<name>--<paired>`) is also used by `--shadow-*` (`--shadow-md` + `--shadow-md--color`).

## Disabling defaults

Tailwind 4 ships a default token catalog. To wipe a namespace before redefining it:

```css
@theme {
  --color-*: initial;          /* drop all default colors */
  --color-brand-500: oklch(0.55 0.18 250);
  --color-bg: oklch(0.99 0 0);
  /* ... */
}
```

The `*: initial` form is namespace-scoped. To wipe everything (rare; do not do this in MedBridge): `@theme { --*: initial; }`.

## Functional `@utility` (v4-only)

The `@utility` directive accepts placeholder values resolved against namespace tokens via `--value(...)` and `--modifier(...)`:

```css
@utility tab-* {
  tab-size: --value(integer, [integer]);
}
```

This generates `tab-2`, `tab-4`, `tab-[7]`, etc. The first call accepts an integer literal; the bracketed form accepts an arbitrary integer.

Resolving against a token namespace:

```css
@utility card-* {
  border-radius: --value(--radius-*);
  background: --value(--color-*);
}
```

This generates `card-md`, `card-brand-500`, etc., picking up any `--radius-*` and `--color-*` token defined in `@theme`.

Modifiers (the `/N` suffix as in `bg-brand-500/80`):

```css
@utility tint-* {
  color: --value(--color-*);
  opacity: --modifier(percentage);
}
```

This generates `tint-brand-500/80`.

## v3 → v4 migration cheat sheet

| v3                                          | v4                                                  |
|---------------------------------------------|-----------------------------------------------------|
| `tailwind.config.js` + `theme.extend.colors`| `@theme { --color-*: ...; }`                        |
| `@tailwind base; components; utilities;`    | `@import "tailwindcss";`                            |
| `@layer utilities { .foo { ... } }`         | `@utility foo { ... }`                              |
| `postcss.config.js` + `tailwindcss` plugin  | `@tailwindcss/vite` plugin (no PostCSS)             |
| `content: [...]` array                      | Auto-discovered via Vite module graph               |
| `darkMode: 'class'`                          | `@custom-variant dark (&:where(.dark, .dark *));`   |
| `theme.extend.fontFamily.sans = [...]`      | `--font-sans: ...;` in `@theme`                     |
| `theme.spacing = { 1: '4px', ... }`         | `--spacing: 0.25rem;` (one base unit)               |
| Tailwind plugins (`@tailwindcss/forms`, etc.) | Most are unnecessary; use `@plugin "name"` only if still required and v4-compatible |

## Plugin loading

If a plugin is still needed:

```css
@plugin "@tailwindcss/typography";
```

Place `@plugin` directives after `@import "tailwindcss"` and before `@theme`.

Avoid plugins when the same effect can be expressed with `@theme` + `@utility`. MedBridge currently uses **no** Tailwind plugins.

## Naming conventions for MedBridge tokens

- Brand: `--color-brand-{50,100,...,950}` — the 11-shade scale.
- Semantic: `--color-{bg,fg,muted,border,ring,accent,danger,success,warning,info}` — single value each, dark-mode-aware via `:root.dark` overrides.
- Spacing: `--spacing` only. Use the computed scale (`p-1`, `p-2`, ..., `p-96`).
- Radius: `--radius-{sm,md,lg,xl,full}`. `--radius-full: 9999px;`.
- Typography: `--font-{sans,mono}`. Custom sizes only when the design system needs a value off the default scale.

Cross-link: token contrast pairs are verified in `accessibility.md`; dark overrides in `dark-mode.md`.
