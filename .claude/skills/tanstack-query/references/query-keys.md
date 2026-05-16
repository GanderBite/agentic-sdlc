# Query keys — factory pattern

## Why a factory

Inline keys (`['patient', id]`) at the call site cause three problems:
1. Typos drift between read sites and invalidate sites — `invalidateQueries({ queryKey: ['patients', id] })` is a silent no-op when the read site used `'patient'`.
2. Adding a new key segment (e.g. `version`, `locale`) requires editing N call sites.
3. The cache becomes impossible to audit: which keys exist?

The factory pattern centralizes key composition in one file per entity.

## Hierarchy

Always design keys in a 3-level hierarchy:

```ts
export const patientKeys = {
  all: ['patient'] as const,
  lists: () => ['patient', 'list'] as const,
  list: (filters: PatientFilters) => ['patient', 'list', filters] as const,
  detail: (id: string) => ['patient', id] as const,
  related: (id: string, rel: 'documents' | 'appointments') =>
    ['patient', id, rel] as const,
} as const;
```

Invalidation rules then read intuitively:

- After updating one patient: `invalidateQueries({ queryKey: patientKeys.detail(id) })`.
- After a bulk import: `invalidateQueries({ queryKey: patientKeys.all })` — invalidates EVERY key starting with `['patient']`.
- After changing filter UI: `invalidateQueries({ queryKey: patientKeys.lists() })` — invalidates ALL list variants but leaves details alone.

## Parameterized lists

Filters must be a stable, structurally-equal object. TanStack Query uses deep equality on the key, so:

```ts
// Good — same object shape → same cache slot
patientKeys.list({ status: 'active', q: '' })

// Bad — extra undefined keys change structural identity
patientKeys.list({ status: 'active', q: '', archived: undefined })
```

Normalize filters before keying. If the route's search-param schema (Zod) already normalizes, the schema's `.parse()` output is safe to feed in directly.

## Pagination + infinite queries

For infinite scrolls, append `'infinite'` and exclude `pageParam` from the key:

```ts
export const patientInfiniteKeys = {
  list: (filters: PatientFilters) =>
    ['patient', 'list', 'infinite', filters] as const,
};

export const patientInfiniteQuery = (filters: PatientFilters) =>
  infiniteQueryOptions({
    queryKey: patientInfiniteKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api.patients.list({ ...filters, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
```

## Returning the options bundle, not just the key

Always export a `queryOptions(...)` factory in addition to the key factory. The options bundle is what both the loader and the component consume:

```ts
export const patientQuery = (id: string) =>
  queryOptions({
    queryKey: patientKeys.detail(id),
    queryFn: ({ signal }) => api.patients.get(id, { signal }),
    staleTime: 60_000,
  });
```

The loader: `ensureQueryData(patientQuery(id))`. The component: `useSuspenseQuery(patientQuery(id))`. The cache slot, query function, and stale time are guaranteed identical because both call sites consume the SAME factory.

## Cancellation via AbortSignal

`queryFn` receives `{ signal }` from TanStack Query. Always thread it into the fetch wrapper so that route navigation cancels in-flight requests:

```ts
queryFn: ({ signal }) => api.patients.get(id, { signal })
```

The hand-written wrapper must forward `signal` to `fetch`.
