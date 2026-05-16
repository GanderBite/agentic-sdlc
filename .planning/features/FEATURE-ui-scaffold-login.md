---
slug: ui-scaffold-login
title: "UI scaffold + Login page + protected-route shell"
primary_users: ["patient","doctor"]
depends_on: ["api-scaffold-auth"]
estimated_task_count: 12
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
- Submitting `/login` with valid seeded credentials navigates to `/dashboard` and `GET /api/auth.me` succeeds on the next request thanks to the cookies set by the login response.
- Submitting `/login` with invalid credentials renders an inline error region with `role="alert"` and does not navigate away.
- Visiting `/dashboard` without a valid session redirects to `/login`.
- The typed client retries a 401 response from any non-auth endpoint exactly once via `POST /api/auth.refresh` and replays the original request on success.
- The logout button issues `POST /api/auth.logout`, clears in-memory auth state, and returns the user to `/login`.

