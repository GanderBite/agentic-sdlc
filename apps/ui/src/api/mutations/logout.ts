import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../auth.js';

/**
 * Mutation hook for POST /api/logout.
 * Uses onSettled (not onSuccess) so the cache is cleared whether the
 * logout request resolves or rejects — preventing stale auth state.
 */
export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => {
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
