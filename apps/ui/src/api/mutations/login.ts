import type { LoginRequest } from '@medbridge/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../auth.js';

/**
 * Mutation hook for POST /api/login.
 * On success, writes the returned user into the ['auth','me'] cache entry
 * so useMe() reflects the authenticated user immediately without a refetch.
 */
export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginRequest) => api.login(input),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], { user: data.user });
    },
  });
}
