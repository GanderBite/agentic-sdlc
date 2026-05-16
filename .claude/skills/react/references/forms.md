# Forms — react-hook-form + Zod + Shadcn

Forms in `apps/ui` use `react-hook-form ^7.54.x` with `@hookform/resolvers/zod`. Schemas live in `packages/contracts` and are shared with the API.

## Basic shape

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatePatientSchema, type CreatePatientInput } from '@medbridge/contracts';

export function CreatePatientForm({ onSubmit }: { onSubmit: (v: CreatePatientInput) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreatePatientInput>({
    resolver: zodResolver(CreatePatientSchema),
    defaultValues: { name: '', dob: '' },
    mode: 'onBlur',
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Name" error={errors.name?.message}>
        <input id="name" {...register('name')} />
      </Field>
      <Field label="Date of birth" error={errors.dob?.message}>
        <input id="dob" type="date" {...register('dob')} />
      </Field>
      <button type="submit" disabled={isSubmitting}>Create</button>
    </form>
  );
}
```

## Controller for Radix/Shadcn

Radix primitives manage their own state (Select, Switch, Checkbox, RadioGroup). Bridge them with `<Controller>`:

```tsx
import { Controller } from 'react-hook-form';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

<Controller
  control={control}
  name="status"
  render={({ field, fieldState }) => (
    <Select value={field.value} onValueChange={field.onChange}>
      <SelectTrigger aria-invalid={!!fieldState.error}>
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectContent>
    </Select>
  )}
/>
```

Rules:

- Inputs that take a `ref` and emit native `change` events → `register('name')`.
- Components that own their value (Radix Select, Switch, Combobox, Checkbox) → `<Controller>`.
- Never mix the two on the same field.

## Default values and reset

Always set `defaultValues` to a fully-shaped object — every field present, no `undefined` values. This prevents the controlled/uncontrolled flip warning and gives Zod a typed seed.

```tsx
useForm<CreatePatientInput>({
  defaultValues: { name: '', dob: '', notes: '' },
});
```

To reset after a successful submit:

```tsx
await onSubmit(values);
form.reset();          // back to defaultValues
form.reset(values);    // make the just-submitted values the new baseline
```

## Server errors

Map server-side validation errors into the form via `setError`:

```tsx
const onSubmit = handleSubmit(async (values) => {
  const res = await api.patients.create(values);
  if (!res.ok && res.error.code === 'VALIDATION') {
    for (const issue of res.error.issues) {
      form.setError(issue.path as keyof CreatePatientInput, { message: issue.message });
    }
    return;
  }
  // ...
});
```

## Multi-step wizards

- Use a single `useForm` instance for the whole wizard.
- Validate per-step with `trigger(['fieldA', 'fieldB'])` before advancing.
- Persist intermediate state to TanStack Router search params if a refresh must survive.

## Accessibility

- Every input has an associated `<label>` (Shadcn `<Label htmlFor>`).
- `aria-invalid` toggles on errors.
- Render the error in an element with `role="alert"` adjacent to the input; reference it via `aria-describedby={errorId}`.
- `noValidate` on the `<form>` so the browser does not race Zod's messages.

## Anti-patterns

- Re-deriving Zod schemas in the UI. Always import from `packages/contracts`.
- Reading `getValues()` inside a submit handler to skip validation.
- Using `setValue` to fake user input during render.
- Watching the whole form with `watch()` and re-rendering the world; use `useWatch({ control, name: 'field' })` scoped to a child.
