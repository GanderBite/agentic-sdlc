import { createFileRoute } from '@tanstack/react-router';

import { LogoutButton } from '@/features/auth/LogoutButton';

export const Route = createFileRoute('/__protected/dashboard')({
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      <LogoutButton />
    </main>
  );
}
