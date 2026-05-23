# File-based routing grammar — TanStack Router 1.95

The Vite plugin (`@tanstack/router-plugin/vite`) walks `apps/ui/src/routes/` and emits `routeTree.gen.ts`. The filename grammar below is exhaustive. Every other name is rejected by the plugin (or silently treated as a leaf).

## Filename tokens

| Token                                | Meaning                                                          | Example file                                  | Matches URL                |
|--------------------------------------|------------------------------------------------------------------|-----------------------------------------------|----------------------------|
| `__root.tsx`                         | Root layout. EXACTLY ONE per app, at `routes/__root.tsx`.        | `routes/__root.tsx`                           | (everything)               |
| `index.tsx`                          | The route at the parent folder's exact path.                     | `routes/patients/index.tsx`                   | `/patients`                |
| `<name>.tsx`                         | Static segment.                                                  | `routes/login.tsx`                            | `/login`                   |
| `$<param>.tsx`                       | Dynamic segment captured as `params.<param>`.                    | `routes/patients/$patientId.tsx`              | `/patients/:patientId`     |
| `_<name>.tsx`                        | Pathless layout. Adds chrome/guards via `<Outlet />`, no URL.    | `routes/_authed.tsx`                          | (children inherit)         |
| `$.tsx`                              | Splat (catch-all). Captures remainder as `params._splat`.        | `routes/$.tsx`                                | any unmatched              |
| `<a>.<b>.tsx` (dot-nesting)          | Flat-file alternative to folder nesting. `a.b.tsx` = `a/b.tsx`.  | `routes/patients.$patientId.edit.tsx`         | `/patients/:patientId/edit`|
| `<name>.lazy.tsx`                    | Code-split companion. Component lives here; route metadata in `<name>.tsx`. | `routes/patients.$patientId.lazy.tsx` | (same as base file) |

## When to use folders vs dot-nesting

- **Folders**: any subtree with more than one leaf or with a layout route. The layout file is `<folder>/_layout.tsx` (pathless) OR the folder's `index.tsx` (path).
- **Dot-nesting**: single-leaf deep paths where adding a folder would create a directory with one file. Keeps the route tree shallow.
- **Mixing**: legal but inconsistent — pick one per subtree.

## Examples

```
routes/
  __root.tsx                                # root layout (always)
  index.tsx                                 # /
  login.tsx                                 # /login
  $.tsx                                     # catch-all 404
  _authed.tsx                               # pathless auth guard layout
  _authed/
    dashboard.tsx                           # /dashboard
    patients/
      index.tsx                             # /patients
      $patientId.tsx                        # /patients/:patientId  (layout or leaf)
      $patientId.edit.tsx                   # /patients/:patientId/edit
      $patientId.documents.$documentId.tsx  # /patients/:patientId/documents/:documentId
    _doctor/                                # nested pathless layout (role guard)
      schedule.tsx                          # /schedule  (only for doctors)
      slots.tsx                             # /slots
```

## Code-splitting: `lazy: true` vs `.lazy.tsx`

| Form                  | Where the component lives           | When to use                                                            |
|-----------------------|-------------------------------------|------------------------------------------------------------------------|
| `lazy: true` flag     | Same file as `createFileRoute`      | Small route file, no heavy local imports. Easiest, but the whole file is in the chunk including the route-config object. |
| `<name>.lazy.tsx`     | Separate sibling file               | Heavy local imports (charts, editors, PDF viewers). Route metadata (loader, beforeLoad, validateSearch) stays in `<name>.tsx`; the lazy file exports `Route.update({ component })`. |

The `.lazy.tsx` form is the recommended default for any non-trivial route in MedBridge — it keeps the route metadata (including guards) in the eager bundle so the router can decide redirects without loading the component chunk.

```tsx
// routes/patients.$patientId.tsx (eager)
export const Route = createFileRoute('/_authed/patients/$patientId')({
  validateSearch: ...,
  beforeLoad: ...,
  loader: ...,
});

// routes/patients.$patientId.lazy.tsx (lazy)
import { createLazyFileRoute } from '@tanstack/react-router';
export const Route = createLazyFileRoute('/_authed/patients/$patientId')({
  component: PatientRoute,
});
```

The plugin merges the two declarations by path.

## Reserved names

- `__root.tsx`, `__root.lazy.tsx` — root layout. EXACTLY ONE.
- `route.tsx` — alternative layout-route file inside a folder (`routes/patients/route.tsx` defines the layout for `/patients`). Use either this OR a pathless `_<name>.tsx` parent — not both for the same scope.
- `routeTree.gen.ts` — generated. Never edit. Add to `.gitignore`? No — commit it so CI builds without running the generator first.

## Not-found and error boundaries by route

- `notFoundComponent` placed on a route handles 404s **for that subtree only**. The router walks up until it finds one.
- Place `notFoundComponent` on `__root` as the catch-all and on any `$param` route whose entity may be missing (so the patient panel can render a "patient not found" panel without losing the auth shell).
- `errorComponent` is invoked when `loader` or `beforeLoad` throws (other than `redirect()` and `notFound()`). Errors propagate up until handled.

## Splat 404

To customise the 404 page beyond the `notFoundComponent` mechanism:

```tsx
// routes/$.tsx
export const Route = createFileRoute('/$')({
  component: () => <NotFoundPage />,
});
```

The splat is the lowest-priority match — every other route wins first.
