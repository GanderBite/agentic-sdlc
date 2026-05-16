# Blocked: task-auth-service

Wave: wave-7
Verdict: partial
Date: 2026-05-16

## Diagnostic

The builder shipped `apps/api/src/modules/auth/service.ts` and all verification
gates pass (biome clean, every `rg` custom check exits 0, file exists). The
factory shape, constant-time login (always one `hasher.verify` call with a
FAKE_STORED_HASH fallback when the email is unknown), refresh-rotation,
replay-detection (`refresh.replay_detected` warn log + `revokeAllActiveForUser`),
and logout behaviours are all correct.

The deviation: `refresh()` and `me()` need to look up the user by id, but
`apps/api/src/modules/auth/repo.ts` does not export `findUserById` and the
task's `target_files` allowed only creating `service.ts`. The builder
inlined a `SELECT` against the Drizzle `db` client at two sites, which
violates the `routes → service → repo → db` layering rule documented in
`docs/ARCHITECTURE.md §2.3`.

## Follow-up

- Add `findUserById(id): Promise<User | undefined>` to
  `apps/api/src/modules/auth/repo.ts` (citext-safe, soft-delete-filtered).
- Refactor the two inline `SELECT` sites in `service.ts` to call the new
  repo function.
- Drop the file-level "layering deviation" comment in `service.ts`.

No retry needed for this wave — implementation is complete and downstream
waves (task-auth-routes, task-app-main) can proceed against the current
service surface. The layering fix is a 5-line follow-up that should land
before sprint close.
