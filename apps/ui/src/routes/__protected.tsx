import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { ApiError } from '@/api/errors';
import { meQueryOptions } from '@/api/queries/me';

export const Route = createFileRoute('/__protected')({
  beforeLoad: async ({ location, context: { queryClient } }) => {
    try {
      await queryClient.ensureQueryData(meQueryOptions());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({
          to: '/login',
          search: { redirect: location.pathname + (location.searchStr ?? '') },
        });
      }
      throw err;
    }
  },
  component: () => <Outlet />,
});
