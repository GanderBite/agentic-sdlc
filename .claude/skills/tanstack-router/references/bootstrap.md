# Router bootstrap, context, and hydration

This page documents the one-time wiring in `apps/ui/src/main.tsx` (or `router.ts` if extracted). Every rule on this page is invariant; treat it as the canonical bootstrap for MedBridge.

## RouterContext shape

The router's `context` is the only place to inject app-wide dependencies that `beforeLoad` / `loader` can read synchronously. MedBridge uses exactly two:

```ts
import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@medbridge/contracts';

export interface RouterContext {
  queryClient: QueryClient;          // shared with the React tree (TanStack Query)
  session: Session | null;           // null until /auth/me resolves; never undefined
}
```

- `queryClient` is the **same** instance passed to `<QueryClientProvider>` so loaders and components share the cache.
- `session` is populated **before** `<RouterProvider>` mounts (see "Hydration order" below). Inside `beforeLoad` it is either a valid session or `null`. Never a promise.

## createRouter

```ts
import { createRouter, createBrowserHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } }, // owned by tanstack-query skill
});

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  context: {
    queryClient,
    session: null, // overridden synchronously by RouterProvider's `context` prop on each render
  } satisfies RouterContext,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: GlobalPendingFallback,
  defaultErrorComponent: GlobalErrorFallback,
  defaultNotFoundComponent: GlobalNotFoundFallback,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

### Why `defaultPreload: 'intent'`

`'intent'` preloads on hover/focus of a `<Link>`. For a clinic app with low concurrency, this is the right default — it warms the loader before the click without speculatively fetching every visible link. Override per-link with `preload={false}` for destructive nav (sign-out, delete) where preloading is wasteful.

### `defaultPreloadStaleTime`

Set to `0` to delegate freshness to TanStack Query's own `staleTime`. Setting both creates two stale clocks and surprises follow.

## Hydration order

The auth session must be known **before** the router decides redirects on the first navigation. The bootstrap pattern:

```tsx
// apps/ui/src/main.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { fetchSession } from './api/auth';
import { queryClient, router } from './router';

function AppRoot() {
  // useSuspenseQuery is acceptable here because main.tsx wraps in <Suspense>.
  const { data: session } = useSuspenseQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchSession,         // returns Session | null, never throws on 401
    staleTime: Infinity,
  });
  return (
    <RouterProvider router={router} context={{ queryClient, session }} />
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Suspense fallback={<BootSplash />}>
      <AppRoot />
    </Suspense>
  </QueryClientProvider>,
);
```

Key invariants:

1. `RouterProvider`'s `context` prop overrides per-render values from the `createRouter({ context })` defaults. This is how `session` flows in from React land.
2. `fetchSession` must resolve to `Session | null` and **never throw on 401** — the `null` branch is the "logged out" state. Throwing makes the entire app suspend on the error boundary on every load.
3. Wrap `<AppRoot />` in `<Suspense>` so the boot fetch can suspend without breaking the first paint.

## CSRF token wiring

The CSRF token cookie is set by `/auth/login` and rotated by `/auth/refresh`. The fetch wrapper in `apps/ui/src/api/` reads `document.cookie` (the `csrf_token` cookie is **not** HttpOnly by design — double-submit pattern) and attaches it as the `x-csrf-token` header on every state-changing request. This is owned by the `hono` and `react` skills; the router has no role beyond reading the resulting `session` value.

## Test helpers

For unit tests, swap to in-memory history:

```ts
import { createMemoryHistory, createRouter } from '@tanstack/react-router';

const testRouter = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/patients/123'] }),
  context: { queryClient, session: testSession },
});
```

Memory history is the only history allowed outside production. Per the brief, no UI tests are written today — this helper exists for future use.

## Devtools

```tsx
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

{import.meta.env.DEV && <TanStackRouterDevtools router={router} position="bottom-right" />}
```

Devtools must be gated on `import.meta.env.DEV` so they tree-shake out of production bundles.

## Common bootstrap mistakes

- Creating a second `QueryClient` for `<QueryClientProvider>` and a different one for the router context. Both must be the same instance, or loaders write to a cache the components never read.
- Forgetting the `declare module` block. The first symptom is `<Link to="/...">` accepting any string. The second symptom is `useParams()` returning `Record<string, string>` instead of the typed params object.
- Reading `document.cookie` inside `beforeLoad` to recover the session. Inject the session via context once at boot; treat `beforeLoad` as a pure function of `(context, params, search, location)`.
- Calling `router.navigate()` from module-level code. Only call navigation inside event handlers or `beforeLoad` (via `throw redirect(...)`).
