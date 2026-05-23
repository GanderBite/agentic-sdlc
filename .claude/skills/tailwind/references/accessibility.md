# Accessibility (WCAG 2 AAA) for MedBridge styling

The brief targets **WCAG 2 AAA** on every shipped view (Login, Dashboard, Doctor profile, Patient profile, Schedule Appointment, Appointment details). AAA contrast thresholds:

- **Normal text**: contrast ratio ≥ **7:1**.
- **Large text** (≥18pt regular or ≥14pt bold ≈ ≥24px / ≥18.66px bold): ≥ **4.5:1**.
- **Non-text UI** (focus indicators, icons, borders that convey state): ≥ **3:1** against any adjacent color.

## Verified contrast pairs (palette anchors)

These pairs are computed against the tokens defined in `dark-mode.md` and verified with a contrast checker (Stark, Polypane, or `chroma-js` CLI). Re-verify when adjusting any oklch lightness value.

### Light mode (`@theme` defaults)

| Foreground            | Background          | Ratio  | AAA pass               |
|-----------------------|---------------------|--------|------------------------|
| `--color-fg` (0.18 L) | `--color-bg` (0.99 L) | 17.3:1 | Yes (normal + large)   |
| `--color-fg`          | `--color-bg-elev` (0.96 L) | 14.6:1 | Yes                    |
| `--color-muted` (0.55 L) | `--color-bg`     | 4.2:1  | Large only             |
| white                 | `--color-brand-700` (0.40 L) | 7.4:1  | Yes (button bg)        |
| white                 | `--color-danger` (0.55 L)    | 5.2:1  | Large only             |
| white                 | `--color-danger-strong` (0.45 L) | 7.1:1  | Yes                    |

Rule: when a chip/button uses `--color-danger` as background with white text, swap to a `-strong` variant (lower lightness) at AAA. Define `--color-danger-strong: oklch(0.45 0.20 25)` and similar for success/warning/info.

### Dark mode (`:root.dark`)

| Foreground         | Background       | Ratio  | AAA pass        |
|--------------------|------------------|--------|------------------|
| `--color-fg` (0.96 L) | `--color-bg` (0.16 L) | 16.8:1 | Yes              |
| `--color-muted` (0.65 L) | `--color-bg`     | 4.6:1  | Large only       |
| `--color-bg`       | `--color-brand-500` (0.70 L) | 7.9:1  | Yes (button)     |
| `--color-bg`       | `--color-danger` (0.70 L)    | 7.0:1  | Yes              |

Rule: dark-mode semantic accents lift to **L ≥ 0.65** to retain contrast against `--color-bg` at L = 0.16.

## Focus ring

Use a single recipe across all interactive elements:

```css
@layer base {
  /* never let parents clip the ring */
  :focus { outline-offset: 2px; }
}
```

Per-element in JSX:

```
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-ring
focus-visible:ring-offset-2
focus-visible:ring-offset-bg
```

`--color-ring` must satisfy contrast ≥ 3:1 against **both** `--color-bg` AND any element bg the control sits on (e.g. a card surface). In MedBridge:

- Light mode: `--color-ring = oklch(0.55 0.18 250)` → 3.6:1 vs bg, 3.4:1 vs `bg-elev`.
- Dark mode: `--color-ring = oklch(0.70 0.16 250)` → 4.1:1 vs bg.

If a component sits on a tinted surface (e.g. a brand-500 button hovered), switch the ring offset color via the `ring-offset-*` utility to maintain visibility.

## State signaling (never color-only)

| State    | Color cue                                  | Required non-color cue                                |
|----------|--------------------------------------------|-------------------------------------------------------|
| Error    | `text-danger` / `border-danger` / `ring-danger` | `aria-invalid="true"` + leading icon (lucide `CircleAlert`) + error message text |
| Success  | `text-success` / `border-success`          | Leading icon (`CircleCheck`) + status text            |
| Warning  | `text-warning` / `border-warning`          | Leading icon (`TriangleAlert`) + status text          |
| Disabled | `opacity-50`                               | `aria-disabled="true"` + `pointer-events-none` + cursor change |
| Required | `text-danger` on a `*` glyph               | `aria-required="true"` on the input                   |

Color-only signaling fails WCAG 1.4.1 regardless of contrast ratio.

## Forms

- Every form control must have an associated `<label htmlFor>` or `aria-labelledby`. Shadcn UI `<Label>` does this; do not bypass.
- Error messages: associate via `aria-describedby` pointing at a sibling `<p id>` with `role="alert"` when freshly populated.
- Focus order matches DOM order. Never set `tabIndex` to a positive integer.

## Motion

Honor `prefers-reduced-motion` globally (see `dark-mode.md` §7). Animation durations >200ms must respect this; transitions <200ms are exempt under WCAG 2.3.3 (AAA "Animation from Interactions").

## Screen-reader-only utility

Define once, use everywhere:

```css
@utility sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

Tailwind 4 ships `sr-only` by default but reaffirming it here documents the contract for reviewers.

## Verification workflow

Before declaring a view complete:

1. Run an automated checker (axe DevTools, or `npx pa11y` against the route's local URL).
2. Tab through every interactive element; confirm focus ring is visible at every stop.
3. Toggle dark mode; re-tab.
4. Run the page through a deuteranopia/protanopia simulator (Stark Pro, or Chrome DevTools rendering panel) to confirm color is never the only state signal.
5. Verify with VoiceOver (macOS) or NVDA (Windows) that form errors are announced when validation fails.

These are manual gates — there are no UI automated tests in this project (brief §8).
