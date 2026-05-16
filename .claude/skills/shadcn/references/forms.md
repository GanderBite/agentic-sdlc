# Shadcn Form + react-hook-form + Zod patterns

The Shadcn `form.tsx` primitive wires `react-hook-form` together with Radix primitives and an accessibility-correct error layer. This file expands the integration patterns referenced by SKILL.md Rules 24–27.

## 1. Anatomy of `form.tsx`

`pnpm dlx shadcn@latest add form` writes `apps/ui/src/components/ui/form.tsx` exporting:

- `Form` — re-export of `FormProvider` from `react-hook-form`.
- `FormField` — wraps `Controller` and a `FormFieldContext`.
- `FormItem` — a `<div>` providing a unique `id` to children via `FormItemContext`.
- `FormLabel` — Shadcn `<Label>` wired with `htmlFor={id}` and `data-error`.
- `FormControl` — `<Slot>` that injects `aria-describedby`, `aria-invalid`, and `id`.
- `FormDescription` — `<p id={…-description}>`.
- `FormMessage` — `<p id={…-message}>` rendering `fieldState.error?.message`.
- `useFormField()` — hook returning the active field's id, error, and aria ids.

The `aria-describedby` value is `${id}-description ${id}-message` and `aria-invalid` flips when there is an error. The wiring is set up exactly once by `FormControl` — never duplicate it.

## 2. Plain input

```tsx
<FormField
  control={form.control}
  name="email"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Email</FormLabel>
      <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
      <FormDescription>We will never share this address.</FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

`{...field}` spreads `name`, `value`, `onChange`, `onBlur`, `ref` onto `<Input>`.

## 3. Radix-state-owning primitives

Components like `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider` own their state through Radix. Pass `field.value`/`field.onChange` explicitly — do not spread `{...field}` blindly.

### Select

```tsx
<FormField
  control={form.control}
  name="role"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Role</FormLabel>
      <Select onValueChange={field.onChange} value={field.value}>
        <FormControl>
          <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="doctor">Doctor</SelectItem>
          <SelectItem value="patient">Patient</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Checkbox

```tsx
<FormField
  control={form.control}
  name="acceptTerms"
  render={({ field }) => (
    <FormItem className="flex items-start gap-3">
      <FormControl>
        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
      </FormControl>
      <div>
        <FormLabel>Accept terms</FormLabel>
        <FormMessage />
      </div>
    </FormItem>
  )}
/>
```

### RadioGroup

```tsx
<FormField
  control={form.control}
  name="visibility"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Visibility</FormLabel>
      <FormControl>
        <RadioGroup onValueChange={field.onChange} value={field.value}>
          <FormItem className="flex items-center gap-2">
            <FormControl><RadioGroupItem value="public" /></FormControl>
            <FormLabel className="font-normal">Public</FormLabel>
          </FormItem>
          <FormItem className="flex items-center gap-2">
            <FormControl><RadioGroupItem value="private" /></FormControl>
            <FormLabel className="font-normal">Private</FormLabel>
          </FormItem>
        </RadioGroup>
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Switch

```tsx
<FormField
  control={form.control}
  name="notify"
  render={({ field }) => (
    <FormItem className="flex items-center justify-between">
      <FormLabel>Notifications</FormLabel>
      <FormControl>
        <Switch checked={field.value} onCheckedChange={field.onChange} />
      </FormControl>
    </FormItem>
  )}
/>
```

## 4. Async submit + server error reconciliation

`react-hook-form` exposes `form.setError('field', { message })` for server-side validation errors. Wire it from your mutation's error handler:

```tsx
async function onSubmit(values: CreatePatientInput) {
  try {
    await createPatient(values);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'PATIENT_DUPLICATE') {
      form.setError('email', { message: 'Email already in use.' });
      return;
    }
    form.setError('root', { message: 'Unexpected error. Try again.' });
  }
}
```

Render `root` errors with `<FormMessage>` against `form.formState.errors.root`:

```tsx
{form.formState.errors.root && (
  <p role="alert" className="text-destructive text-sm">
    {form.formState.errors.root.message}
  </p>
)}
```

## 5. Multi-step wizards

Use one `useForm` instance at the wizard root with `mode: 'onTouched'` and gate `next` on per-step validation:

```tsx
async function next() {
  const ok = await form.trigger(STEP_FIELDS[step]);
  if (ok) setStep(step + 1);
}
```

`STEP_FIELDS` is a tuple of field names per step derived from your Zod schema. Never reset the form between steps — Zod's partial schemas are not needed; trigger-by-field is.

## 6. File inputs

`<Input type="file">` is uncontrolled. Use the lower-level `<Controller>` form, not `<FormField>`, and pull the `FileList` from `e.target.files`:

```tsx
<FormField
  control={form.control}
  name="attachment"
  render={({ field: { onChange, value, ...field } }) => (
    <FormItem>
      <FormLabel>Attachment</FormLabel>
      <FormControl>
        <Input
          type="file"
          accept="application/pdf"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          {...field}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

The Zod schema for this field is `z.instanceof(File)` (browser) or a custom `z.custom<File>()` predicate.

## 7. Forbidden patterns

- Passing an `error` prop to `<Input>` or `<Select>` and ignoring `<FormMessage>`. Breaks `aria-describedby`.
- Wiring `aria-invalid` by hand. `FormControl` already does it; double-wiring flips it back.
- Calling `register()` on a primitive that owns its state via Radix (Select/Checkbox/etc.). Always use `FormField` + `field.onChange`.
- Validating client-side with a schema that diverges from `packages/contracts`. Single source of truth; import the schema.
