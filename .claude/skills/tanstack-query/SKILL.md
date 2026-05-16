<!-- version: 1.0.0 -->

# tanstack-query

## Purpose

Encodes idiomatic TanStack Query `^5.62.x` usage in `apps/ui` (React 19): query-key factories, `useQuery` / `useSuspenseQuery`, `useMutation`, optimistic updates with rollback, integration with the hand-written typed `fetch` client, and pairing with TanStack Router loaders.

## Consumers

- `builder` — writes `apps/ui/src/api/queries/**`, `apps/ui/src/api/mutations/**`, route loaders, and React components that read server state.
- `code-reviewer` — checks PRs touching `apps/ui/src/api/**` and component data flow.

## Stack constants (do not deviate)

- `@tanstack/react-query` `^5.62.x`, React `^19.0.x`, TanStack Router `^1.95.x`.
- HTTP transport: hand-written `fetch` wrapper under `apps/ui/src/api/` (no `ky`, no `axios`, no Hono RPC client).
- Schemas + inferred types from `packages/contracts` (Zod v4). Never redefine request/response shapes in `apps/ui`.
- Auth: session JWT cookie + CSRF double-submit. The fetch wrapper attaches the CSRF header on mutating verbs.
- Server errors arrive as `AppError` JSON; the fetch wrapper rejects with a typed `AppError` instance (see `references/error-handling.md`).

## Rules

### QueryClient configuration

1. Construct exactly one `QueryClient` in `apps/ui/src/main.tsx` and pass it to `<QueryClientProvider>` and into the router context. Never instantiate a second `QueryClient` at runtime.
2. Set `defaultOptions.queries.staleTime` to a non-zero value (e.g. `30_000`). Never leave it at the `0` default — every focus and remount would otherwise refetch.
3. Set `defaultOptions.queries.gcTime` only when overriding the 5-minute default; document the reason in the `main.tsx` config comment.
4. Disable retries on 4xx responses. Pass a `retry: (failureCount, error) => …` function that returns `false` when `error` is an `AppError` with `status >= 400 && status < 500`. Allow up to 1 retry on 5xx/network errors.
5. Set `refetchOnWindowFocus: false` for the default; opt in per-query when stale-on-focus is desired.

### Query keys

6. Define every query key in a factory file under `apps/ui/src/api/queries/<entity>.ts`. Never inline a query key at the call site.
7. Start every key with a lowercase string namespace matching the entity, e.g. `['patient', …]`. Use hierarchical tuples: `all`, `lists(filters)`, `detail(id)`.
8. Use `as const` on every tuple literal so TypeScript narrows the key tuple type. Keys feed `invalidateQueries({ queryKey })` by prefix.
9. Export a `queryOptions(...)` factory per fetch (not just the key). The factory returns `{ queryKey, queryFn, staleTime?, … }` and is consumed by both `useSuspenseQuery` and `queryClient.ensureQueryData` to keep options identical between loader and component.

### Reading data

10. Use `useSuspenseQuery(options)` for data the component cannot render without. The route loader must call `queryClient.ensureQueryData(options)` with the SAME `queryOptions(...)` factory.
11. Use `useQuery(options)` only when a non-suspending loading state is required (inline async region inside an already-rendered page, e.g. a dependent dropdown).
12. Never call `useQuery` for data the route loader already fetched. Use `useSuspenseQuery` with the same factory.
13. Read `useSuspenseQuery(...).data` as non-nullable. Do not write `if (!data) return …` — the suspense boundary already gated rendering.

### Mutations

14. Define mutations inline at the call site with `useMutation({ mutationFn, onSuccess, onError, onSettled })`. Co-locate complex mutation helpers under `apps/ui/src/api/mutations/<entity>.ts` only when reused.
15. Call the typed fetch wrapper in `mutationFn`. Never `fetch(...)` directly in a component.
16. In `onSuccess`, invalidate by the broadest correct key prefix using the factory: `queryClient.invalidateQueries({ queryKey: patientKeys.detail(id) })`. Never call `refetch()` on another component's query handle.
17. Surface errors via `onError` (toast/inline message) using the typed `AppError`. Never `try/catch` around `mutate(...)` — `mutate` does not throw.
18. Use `mutate(input)` for fire-and-forget UX; use `mutateAsync(input)` only when the caller awaits the result (e.g. step transitions in a wizard). Wrap `mutateAsync` in `try/catch` to suppress the unhandled rejection that fires on error.

### Optimistic updates

19. For single-record toggles/edits, use the cache-write pattern: `onMutate` cancels in-flight queries, snapshots prior cache, writes the optimistic value, returns the snapshot as `context`.
20. Roll back in `onError` by writing the snapshot from `context.prev` back to the cache.
21. Reconcile in `onSettled` by invalidating the affected key prefix so the server state replaces the optimistic value.
22. For local, component-scoped optimism (no shared cache concern), prefer React 19's `useOptimistic` — see the `react` skill, rule 11.

### Router pairing

23. Every route that needs server data must declare a `loader` returning `context.queryClient.ensureQueryData(<factory>())`. The route component then reads with `useSuspenseQuery(<same factory>())`.
24. Pass the `queryClient` into the router via `context: { queryClient }`. The `loader` receives it as `({ context, params }) => …`.
25. Place the route-level Suspense fallback in `pendingComponent`, route-level errors in `errorComponent`. Never wrap an entire route in a hand-rolled `<Suspense>`.

### Error boundaries

26. Let render-time query errors propagate. `useSuspenseQuery` throws on error; the nearest TanStack Router `errorComponent` (or a `react-error-boundary` boundary) catches it.
27. Never call `.catch()` on a promise inside the component body to swallow query errors.
28. For non-suspending `useQuery`, branch on `query.isError` and render the inline error UI from the `AppError` taxonomy (see `references/error-handling.md`).

### Forbidden

29. Never import from `@tanstack/react-query-devtools` outside `main.tsx` (and only in dev builds).
30. Never instantiate `QueryClient` inside a component body or inside a route module.
31. Never use `useQueries` to parallelize when a route loader can call `Promise.all([ensureQueryData(a), ensureQueryData(b)])` instead.
32. Never persist the query cache to `localStorage` without an explicit security review — auth-bound data must not survive logout.

## Template — query factory (`apps/ui/src/api/queries/patient.ts`)

```ts
import { queryOptions } from '@tanstack/react-query';
import type { Patient, PatientFilters } from '@medbridge/contracts';
import { api } from '@/api/client';

export const patientKeys = {
  all: ['patient'] as const,                                  // REQUIRED root
  lists: () => ['patient', 'list'] as const,                  // REQUIRED list root
  list: (filters: PatientFilters) =>
    ['patient', 'list', filters] as const,                    // REQUIRED parameterized list
  detail: (id: string) => ['patient', id] as const,           // REQUIRED detail
} as const;

export const patientQuery = (id: string) =>
  queryOptions({
    queryKey: patientKeys.detail(id),
    queryFn: ({ signal }) => api.patients.get(id, { signal }),
    staleTime: 60_000,                                        // OPTIONAL override
  });

export const patientListQuery = (filters: PatientFilters) =>
  queryOptions({
    queryKey: patientKeys.list(filters),
    queryFn: ({ signal }) => api.patients.list(filters, { signal }),
  });
```

## Template — QueryClient bootstrap (`apps/ui/src/main.tsx`)

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/api/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
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

## Template — route loader + suspense read

```tsx
// apps/ui/src/routes/patients/$patientId.tsx
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { patientQuery } from '@/api/queries/patient';

export const Route = createFileRoute('/patients/$patientId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(patientQuery(params.patientId)),
  component: PatientRoute,
  pendingComponent: () => <PatientSkeleton />,
  errorComponent: ({ error }) => <ErrorPanel error={error} />,
});

function PatientRoute() {
  const { patientId } = Route.useParams();
  const { data } = useSuspenseQuery(patientQuery(patientId));
  return <PatientPanel patient={data} />;
}
```

## Template — mutation + invalidation

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { patientKeys } from '@/api/queries/patient';
import type { UpdatePatientInput } from '@medbridge/contracts';

export function useUpdatePatient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePatientInput) => api.patients.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientKeys.detail(id) });
      qc.invalidateQueries({ queryKey: patientKeys.lists() });
    },
    onError: (e) => toastError(e),
  });
}
```

## Examples

### CORRECT — optimistic toggle with rollback

```tsx
const toggle = useMutation({
  mutationFn: (id: string) => api.patients.toggleArchive(id),
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: patientKeys.detail(id) });
    const prev = qc.getQueryData(patientKeys.detail(id));
    qc.setQueryData(patientKeys.detail(id), (old) =>
      old ? { ...old, archived: !old.archived } : old,
    );
    return { prev };
  },
  onError: (_e, id, ctx) => {
    if (ctx?.prev) qc.setQueryData(patientKeys.detail(id), ctx.prev);
  },
  onSettled: (_d, _e, id) => qc.invalidateQueries({ queryKey: patientKeys.detail(id) }),
});
```

### INCORRECT — inline key + raw fetch + retry on 4xx

```tsx
const { data, isLoading } = useQuery({
  queryKey: ['patient-' + id],                               // violates Rule 6 (inline key), Rule 7 (string, not tuple)
  queryFn: () => fetch(`/api/patients/${id}`).then((r) => r.json()), // violates Rule 15 (bypasses wrapper) and `react` Rule 37
  retry: 3,                                                  // violates Rule 4 (retries 4xx forever)
});
if (!data) return <Spinner />;                               // violates Rule 12 — loader+useSuspenseQuery preferred
```

### INCORRECT — refetch from sibling effect + try/catch around mutate

```tsx
const list = useQuery(patientListQuery({}));
const update = useMutation({ mutationFn: api.patients.update });

function onSubmit(values: UpdatePatientInput) {
  try {
    update.mutate(values);                                   // violates Rule 17 — mutate does not throw
  } catch (e) { /* never runs */ }
}
useEffect(() => { list.refetch(); }, [update.isSuccess]);    // violates Rule 16 — invalidate from onSuccess instead
```

### INCORRECT — new QueryClient inside a component

```tsx
function PatientList() {
  const qc = new QueryClient();                              // violates Rule 1 and Rule 30 — single client at module scope only
  return <QueryClientProvider client={qc}>{/* … */}</QueryClientProvider>;
}
```

## Deeper references

- `references/query-keys.md` — factory layout, prefix-invalidation strategy, parameterized lists, infinite queries.
- `references/mutations.md` — `onMutate`/`onError`/`onSettled` flow, optimistic patterns, `mutateAsync` vs `mutate`, server-action interplay.
- `references/router-integration.md` — `ensureQueryData` vs `prefetchQuery`, parallel-load patterns, context typing, search-param-driven queries.
- `references/error-handling.md` — `AppError` shape, retry policy details, error-boundary placement, toast vs inline rendering.
- `references/config.md` — `staleTime` vs `gcTime` tradeoffs, devtools, persistence, hydration considerations.
