---
slug: ui-scaffold-login
title: "UI scaffold + Login page + protected-route shell"
primary_users: ["patient","doctor"]
depends_on: ["api-scaffold-auth"]
estimated_task_count: 12
enriched_at: 2026-05-23T00:00:00Z
---

# UI scaffold + Login page + protected-route shell

## Summary

Bootstraps apps/ui with React 19, Vite, Tailwind v4, Shadcn, TanStack Router/Query, the hand-written typed client, and the Login + protected-route shell that consumes the auth endpoints.

## Scope

- apps/ui workspace with Vite + React 19 + Tailwind v4 + Shadcn CLI scaffolding
- TanStack Router file-based route tree with `/login` and `/dashboard` placeholders
- TanStack Query provider with default cookie credentials
- Hand-written typed fetch client in apps/ui/src/api/ that echoes csrf_token cookie as X-CSRF-Token and retries once on 401 via auth.refresh
- Login page with email/password form, react-hook-form + Zod resolver against packages/contracts schemas
- Auth context + protected-route loader that redirects unauthenticated users to /login
- Logout button + session reset
- nginx static container in docker-compose serving the built UI bundle

## Out of scope

- Password reset / forgot-password UI
- Dashboard content (only a placeholder route; populated in role-aware-dashboards)
- Theming / dark mode
- UI unit, component, or e2e tests (per brief §8)

## Acceptance bullets

- `pnpm -r build` emits an `apps/ui/dist/` bundle and `docker compose up ui` serves `index.html` on the configured UI port via nginx.
- Navigating to `/login` renders an accessible email/password form (every input has a programmatic `<label>` and visible focus ring).
- Submitting `/login` with valid seeded credentials navigates to `/dashboard` and `GET /api/me` succeeds on the next request thanks to the cookies set by the login response.
- Submitting `/login` with invalid credentials renders an inline error region with `role="alert"` and does not navigate away.
- Visiting `/dashboard` without a valid session redirects to `/login`.
- The typed client retries a 401 response from any non-auth endpoint exactly once via `POST /api/refresh` and replays the original request on success.
- The logout button issues `POST /api/logout`, clears in-memory auth state, and returns the user to `/login`.
- The typed client targets the existing plain `/api/<verb>` paths (`/api/login`, `/api/refresh`, `/api/logout`, `/api/me`); the future `/api/auth.<verb>` rename (open debt F-202) is deferred to a later sprint.
- Auth state is read exclusively from the TanStack Query cache via a `useMe()` hook backed by `useQuery({ queryKey: ['auth','me'], queryFn: api.me })`; no React Context, Zustand, or other parallel store is introduced.
- When two or more requests fail with 401 concurrently, exactly one `POST /api/refresh` is issued; concurrent failures await the same in-flight promise and replay their original request on success (single-flight coalescing in the typed client).
- The protected-route shell is implemented as a TanStack Router `__protected` layout route whose `beforeLoad` calls `queryClient.ensureQueryData({ queryKey: ['auth','me'], queryFn: api.me })` and `throw redirect({ to: '/login', search: { redirect: location.pathname + location.search } })` when the call fails with 401.
- After successful login, the app navigates to the `redirect` search param when present (URL-decoded, same-origin path only) and falls back to `/dashboard` otherwise.
- The logout button optimistically invalidates the `['auth','me']` query, clears any cached auth data, and navigates to `/login` regardless of whether `POST /api/logout` resolves or rejects (errors are logged, not surfaced).

## Clarifications

- **Q: Which API paths should the UI client target — the current `/api/<verb>` paths or the `/api/auth.<verb>` paths the system architecture prescribes?**
  A: Wire the UI against the current plain `/api/<verb>` paths and defer the rename to a later sprint.
- **Q: Where does auth state live on the client — a dedicated React context/store, or read directly from the TanStack Query cache?**
  A: TanStack Query cache only — read the `meResponse` via `useQuery` wherever needed, no separate context.
- **Q: How should the typed client coalesce concurrent 401 retries so only one `POST /api/refresh` is issued?**
  A: Single-flight: the first 401 triggers one `auth.refresh` call; concurrent 401s await the same promise and replay on success (recommended).
- **Q: How is the protected-route guard expressed in TanStack Router?**
  A: `beforeLoad` on a `__protected` layout route that throws `redirect({ to: '/login' })` when the auth context is missing (recommended).
- **Q: Should the login page preserve the originally requested URL for post-login redirect?**
  A: Yes — encode it as `/login?redirect=<encoded path>` and navigate there post-login, falling back to `/dashboard` (recommended).
- **Q: What does the logout button do when `POST /api/logout` fails (network error or 5xx)?**
  A: Optimistically clear in-memory auth state and navigate to `/login` regardless of the response (recommended).
