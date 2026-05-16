# QueryClient configuration

## `staleTime` vs `gcTime`

- **`staleTime`** — how long data is considered fresh. Fresh data does NOT refetch on mount, focus, or reconnect. Default: `0` (always stale → refetches eagerly).
- **`gcTime`** (formerly `cacheTime`) — how long inactive cache entries linger before garbage collection. Default: `5 * 60 * 1000` (5 min).

Rule of thumb:

| Data character                          | `staleTime`     |
|-----------------------------------------|-----------------|
| Hot list view (frequently mutated)      | 10-30 s         |
| Detail page (mostly read)               | 30-120 s        |
| Reference data (specializations, roles) | 5-15 min        |
| Static lookup (countries, currencies)   | `Infinity`      |

`gcTime` rarely needs tuning — leave at 5 min unless memory becomes a concern (e.g. large list pages with infinite cache growth).

## Recommended defaults for MedBridge

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,                         // default; explicit for clarity
      refetchOnWindowFocus: false,                   // medical data; refocus refetches are jarring
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
```

## Per-query overrides

Override at the `queryOptions` site, not at the call site:

```ts
export const specializationsQuery = () =>
  queryOptions({
    queryKey: ['specialization', 'list'] as const,
    queryFn: ({ signal }) => api.specializations.list({ signal }),
    staleTime: 10 * 60 * 1000,        // reference data — refetch rarely
  });
```

This keeps `useSuspenseQuery(specializationsQuery())` and `ensureQueryData(specializationsQuery())` in lockstep.

## Devtools

```tsx
// apps/ui/src/main.tsx — dev only
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

if (import.meta.env.DEV) {
  // <ReactQueryDevtools initialIsOpen={false} />
}
```

Never ship devtools in production builds — Vite tree-shakes the dev-only import behind the `DEV` guard.

## Persistence (intentionally avoided)

TanStack Query offers `@tanstack/react-query-persist-client` to hydrate the cache from `localStorage` between sessions. MedBridge does NOT use it because:

1. Auth-bound data must not survive logout / tab reuse.
2. PII may sit in browser storage across sessions, conflicting with the brief's security floor.
3. The session JWT is 15-min; persisted cache would frequently outlive the auth boundary anyway.

If a future feature needs short-lived persistence (e.g. offline drafts), scope it to non-PII keys via a custom selector.

## SSR / hydration

`apps/ui` is fully client-rendered (Vite SPA). There is no SSR, no `dehydrate()`/`hydrate()`. Skip the SSR section of the official docs entirely.
