import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginRequest, loginRequest } from '@medbridge/contracts';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/api/errors';
import { useLogin } from '@/api/mutations/login';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Inner component so useFormField() is called inside a valid FormField context
function FieldInput({
  field,
  type,
  autoComplete,
  placeholder,
}: {
  field: React.InputHTMLAttributes<HTMLInputElement> & { name: string };
  type: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const { formItemId } = useFormField();
  return (
    <Input
      id={formItemId}
      type={type}
      autoComplete={autoComplete}
      placeholder={placeholder}
      {...field}
    />
  );
}

export function LoginForm() {
  const router = useRouter();
  const { redirect } = useSearch({ from: '/login' });

  const login = useLogin();

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequest),
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(values: LoginRequest): void {
    login.mutate(values, {
      onSuccess: () => {
        void router.navigate({ to: redirect ?? '/dashboard' });
      },
    });
  }

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.message
      : login.error instanceof Error
        ? login.error.message
        : null;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {errorMessage !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <FieldInput
                  field={field}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <FieldInput
                  field={field}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </Form>
  );
}
