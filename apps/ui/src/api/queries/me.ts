import type { MeResponse } from '@medbridge/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { api } from '../auth.js';

/**
 * Static queryOptions factory for the /api/me endpoint.
 * Pass to `queryClient.ensureQueryData(meQueryOptions())` in protected-layout
 * beforeLoad guards so the key is never duplicated at call sites.
 */
export function meQueryOptions() {
  return queryOptions<MeResponse | null>({
    queryKey: ['auth', 'me'],
    queryFn: () => api.me(),
  });
}

/**
 * Hook that reads the authenticated user from the TanStack Query cache.
 * This is the single source of truth for auth state — no React Context,
 * no Zustand, no module-level mutable singleton.
 */
export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: ['auth', 'me'],
    queryFn: () => api.me(),
  });
}
