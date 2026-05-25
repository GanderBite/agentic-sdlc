import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { LoginForm } from '@/features/login/LoginForm';

// Accepts only same-origin relative paths. Rejects:
//   - absolute URLs (http://, https://)
//   - protocol-relative URLs (//)
//   - any other non-relative form
const redirectSearchSchema = z
  .string()
  .transform((val) => decodeURIComponent(val))
  .refine(
    (val) => !val.startsWith('http://') && !val.startsWith('https://') && !val.startsWith('//'),
    { message: 'redirect must be a relative same-origin path' },
  )
  .optional();

const searchSchema = z.object({
  redirect: redirectSearchSchema,
});

export const Route = createFileRoute('/login')({
  validateSearch: (raw) => searchSchema.parse(raw),
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Sign in to MedBridge</h1>
          <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
