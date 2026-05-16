<!-- version: 1.0.0 -->

# tanstack-router

## Purpose

Encodes file-based routing for `apps/ui` with TanStack Router `^1.95.x`: route tree generation, type-safe params/search, loaders, `beforeLoad` guards, code-splitting, nested layouts, and not-found/error components.

## Consumers

- `builder` — writes/edits route files under `apps/ui/src/routes/` and the router bootstrap.
- `code-reviewer` — checks PRs touching `apps/ui/src/routes/**` or `apps/ui/src/main.tsx` against these rules.

## Stack constants (do not deviate)

- Package: `@tanstack/react-router ^1.95.x`. Plugin: `@tanstack/router-plugin/vite`.
- Routes live in `apps/ui/src/routes/`. The generated file is `apps/ui/src/routeTree.gen.ts`.
- Search params are validated by **Zod schemas imported from `packages/contracts`** (never re-defined inline).
- Auth roles are `patient | doctor | admin` (exhaustive). The session JWT is read from a session cookie; the CSRF token from `csrf_token` cookie + matching header — auth wiring belongs to the `hono` and `react` skills; this skill only consumes the resulting `RouterContext`.
- Data fetching is owned by the `tanstack-query` skill. This skill defines only the loader↔query integration contract.

## Rules

### File-based routing

1. Place every route at `apps/ui/src/routes/<segment>.tsx`. The CLI/Vite plugin regenerates `routeTree.gen.ts` — never hand-edit `routeTree.gen.ts`, never commit changes that conflict with regeneration.
2. Use `createFileRoute('<full-path>')` at the top of every route file. The string MUST match the file path; the plugin verifies this.
3. Name dynamic segments with `$` prefix: `$patientId.tsx` → `/patients/$patientId`. Name pathless layout routes with `_` prefix: `_authed.tsx` is a layout wrapper, not a URL segment.
4. Use `index.tsx` for the route at a folder's root (e.g. `routes/patients/index.tsx` → `/patients`). Use `__root.tsx` exactly once for the root layout.
5. See `references/file-routing.md` for the full filename grammar (splat `$`, dot-nesting `foo.bar`, route groups, splat 404).

### Route shape

6. Export the route as `export const Route = createFileRoute(...)({ ... })`. The route options object MUST be the only argument.
7. Provide `component: <RouteComponent>` for every leaf route. For layout routes use `component: () => <Outlet />` or a wrapper that renders `<Outlet />`.
8. Provide `errorComponent` on every route that has a `loader` or `beforeLoad`. Provide `pendingComponent` on every route whose loader can suspend (i.e. returns a promise the router awaits).
9. Provide `notFoundComponent` on `__root` and on any route that owns a parameterised child whose entity may be missing (e.g. `/patients/$patientId`).

### Type safety and the `Register` augmentation

10. Augment the module exactly once in `apps/ui/src/main.tsx` (or `router.ts`) so `<Link>` and hooks resolve to typed paths:

    ```ts
    declare module '@tanstack/react-router' {
      interface Register { router: typeof router }
    }
    ```

    Without this, typed links degrade to `string` silently.
11. Read params with `Route.useParams()` (preferred) or `useParams({ from: '/patients/$patientId' })`. Never destructure from `useRouterState()` to get params.
12. Read validated search with `Route.useSearch()` (preferred) or `useSearch({ from: '/patients' })`. Never parse `window.location.search` by hand and never read raw `URLSearchParams`.
13. Build internal navigation with `<Link to="/patients/$patientId" params={{ patientId: id }}>`. Never use `<a href>` for in-app links. Never construct path strings with template literals.

### Search params (Zod-validated)

14. Define every route's search schema in `packages/contracts` under a name ending `SearchSchema`, e.g. `PatientListSearchSchema`. Import and pass it through `validateSearch: zodValidator(PatientListSearchSchema.parse)` (or `validateSearch: (raw) => PatientListSearchSchema.parse(raw)`).
15. Make optional search keys `.optional()` and provide `.default(...)` only when the route should canonicalise the URL — otherwise omit defaults to keep URLs minimal.
16. Use `Route.useSearch()` to read; use `navigate({ search: (prev) => ({ ...prev, page: 2 }) })` to update. Never spread an untyped object into `search`.

### Loaders + TanStack Query integration

17. The router context exposes `queryClient` (set during router creation, see `references/bootstrap.md`). A route's `loader` MUST call `context.queryClient.ensureQueryData(queryOptions)` and return its result. The component reads the same data via `useSuspenseQuery(queryOptions)` — `queryOptions` is one factory shared by both. Cache semantics (staleTime, gcTime, mutations, invalidation) belong to the `tanstack-query` skill; do not redefine them here.
18. Loaders run on navigation; pass `params`, `search`, and `context` to the query factory. Never call `fetch()` directly in a loader.
19. Use `loaderDeps: ({ search }) => ({ page: search.page })` to declare which search keys retrigger the loader. Without `loaderDeps`, the router treats the loader output as independent of search and may serve stale data.

### Guards (`beforeLoad`)

20. Enforce auth and RBAC in `beforeLoad`, not in the component. `beforeLoad` runs before the loader and before any child route resolves — redirect from there to keep unauthenticated users out of protected loaders.
21. To redirect, **throw** `redirect({ to: '/login', search: { next: location.href } })`. The thrown sentinel is the only redirect mechanism inside `beforeLoad` and `loader`. Never `return redirect(...)` from a guard, never call `useNavigate()` inside a guard or loader.
22. Group authenticated routes under a pathless layout (`routes/_authed.tsx`) that holds the `beforeLoad` guard and renders `<Outlet />`. Place role-specific guards under role layouts (`_authed/_doctor.tsx`, `_authed/_admin.tsx`).
23. Read the session from `context.session` (populated when creating the router — see `references/bootstrap.md`). Never call a network endpoint inside `beforeLoad`; the session is already in router context.

### Code-splitting

24. Mark every non-critical route with `lazy: true` in `createFileRoute(...)({ lazy: true, ... })` OR colocate the component in a `<segment>.lazy.tsx` file (e.g. `patients.$patientId.lazy.tsx`). The plugin emits a separate chunk for each. See `references/file-routing.md` for which form to pick.
25. Never lazy-load `__root`, `_authed` (the auth shell), or `routes/login.tsx`. Keep the auth/login bundle in the initial entry.

### Nested layouts and Outlet

26. A layout route renders `<Outlet />` exactly once for its child routes. Place shared chrome (sidebar, header, breadcrumbs) in the layout component, not in every leaf.
27. Compose layouts by nesting folders: `routes/_authed/patients/$patientId/edit.tsx` inherits guards/chrome from `_authed.tsx` and from `_authed/patients/$patientId.tsx` (if it exists as a layout). Do not duplicate guard logic across siblings — hoist it.

### Forbidden

28. Never import from `routeTree.gen.ts` in route files. Only `apps/ui/src/main.tsx` (router bootstrap) imports it.
29. Never use the memory history outside tests. Production uses the browser history created in `createRouter({ history: createBrowserHistory() })` by default — do not override it.
30. Never read or set cookies/localStorage in `beforeLoad` or `loader`. Hydrate the router context once at bootstrap (see `references/bootstrap.md`) and rely on it.

## Template — leaf route with guard, loader, search, lazy

```tsx
// apps/ui/src/routes/_authed/patients/$patientId.tsx
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { PatientDetailSearchSchema } from '@medbridge/contracts';
import { patientQuery } from '@/api/queries/patient';
import { PatientPanel, PatientSkeleton, ErrorPanel, NotFoundPanel } from '@/features/patients';

export const Route = createFileRoute('/_authed/patients/$patientId')({
  validateSearch: (raw) => PatientDetailSearchSchema.parse(raw),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { next: location.href } });
    }
    if (context.session.role === 'admin') {
      throw redirect({ to: '/admin' });
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(patientQuery(params.patientId)),
  component: PatientRoute,
  pendingComponent: () => <PatientSkeleton />,
  errorComponent: ({ error, reset }) => <ErrorPanel error={error} onReset={reset} />,
  notFoundComponent: () => <NotFoundPanel kind="patient" />,
  lazy: true,
});

function PatientRoute() {
  const { patientId } = Route.useParams();
  const { tab } = Route.useSearch();
  const { data } = useSuspenseQuery(patientQuery(patientId));
  return <PatientPanel patient={data} tab={tab} />;
}
```

## Template — pathless auth layout

```tsx
// apps/ui/src/routes/_authed.tsx
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { next: location.href } });
    }
  },
  component: () => <Outlet />,
});
```

## Examples

### CORRECT — typed link with params + search

```tsx
import { Link } from '@tanstack/react-router';

<Link
  to="/_authed/patients/$patientId"
  params={{ patientId: p.id }}
  search={{ tab: 'overview' }}
  className="underline"
>
  {p.name}
</Link>
```

### INCORRECT — redirect-as-return + raw href + index key

```tsx
// apps/ui/src/routes/_authed/patients/$patientId.tsx
export const Route = createFileRoute('/_authed/patients/$patientId')({
  beforeLoad: ({ context }) => {
    if (!context.session) return redirect({ to: '/login' });  // violates Rule 21 (must throw)
  },
  loader: async ({ params }) => {
    const res = await fetch(`/api/patients/${params.patientId}`); // violates Rule 18 (no raw fetch in loader)
    return res.json();
  },
  component: () => {
    const params = useRouterState().location.params;            // violates Rule 11 (use Route.useParams)
    return <a href={`/patients/${params.patientId}/edit`}>edit</a>; // violates Rule 13 (no raw <a> for in-app nav)
  },
});
```

### INCORRECT — missing `Register` augmentation + hand-parsed search

```tsx
// apps/ui/src/main.tsx — no `declare module` block
const router = createRouter({ routeTree });                      // violates Rule 10 (typed <Link> collapses to string)

// inside a component
const page = Number(new URLSearchParams(window.location.search).get('page')); // violates Rule 12
```

### INCORRECT — guard duplicated across siblings

```tsx
// apps/ui/src/routes/_authed/patients/index.tsx
export const Route = createFileRoute('/_authed/patients/')({
  beforeLoad: ({ context }) => { if (!context.session) throw redirect({ to: '/login' }); }, // violates Rule 27
  component: PatientList,
});
// apps/ui/src/routes/_authed/patients/$patientId.tsx
export const Route = createFileRoute('/_authed/patients/$patientId')({
  beforeLoad: ({ context }) => { if (!context.session) throw redirect({ to: '/login' }); }, // duplicate; hoist into _authed.tsx
  component: PatientRoute,
});
```

## Deeper references

- `references/file-routing.md` — full filename grammar: `__root`, `index`, `$param`, `_layout`, `$` splat, dot-nesting, route groups, lazy-file convention.
- `references/bootstrap.md` — `createRouter` setup, `RouterContext` shape (queryClient + session), `Register` augmentation, `<RouterProvider>`, `defaultPendingComponent` / `defaultErrorComponent`, history selection, hydration order with TanStack Query.

## Glossary

- **Pathless layout**: a route file whose name starts with `_` (e.g. `_authed.tsx`). Contributes guards/chrome via `<Outlet />` but adds no URL segment.
- **Splat route**: `$.tsx` — matches any unmatched suffix. Used for catch-all 404s.
- **Route context**: the per-route object accumulated from `__root` downward via `beforeLoad` return values, exposed as `context` to `loader`, `beforeLoad`, and component hooks.
