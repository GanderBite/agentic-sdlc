import { useRouter } from '@tanstack/react-router';

import { useLogout } from '@/api/mutations/logout';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  const logout = useLogout();

  function handleLogout() {
    logout.mutate(undefined, {
      onError: (err) => {
        console.error('Logout error:', err);
      },
      onSettled: () => {
        void router.navigate({ to: '/login' });
      },
    });
  }

  return (
    <Button variant="outline" onClick={handleLogout} disabled={logout.isPending}>
      Log out
    </Button>
  );
}
