// NOTE: vi.spyOn(passwords, 'verify') will NOT intercept calls made by the
// auth service because ESM bindings are live and the service imports from
// src/shared/password.js directly. This re-export eliminates the divergent
// argon2 wrapper so this helper can never drift from production semantics.
export { hash, verify } from '../../src/shared/password.js';
