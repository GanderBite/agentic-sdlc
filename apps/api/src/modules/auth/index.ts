// Public surface of the auth module.
// Only re-export the factory and the types that other modules or the route
// layer need.  Repo internals, schema, and throttle remain private.

export type {
  AuthService,
  AuthServiceDeps,
  AuthTokens,
  Logger as AuthLogger,
  LoginInput,
  LogoutInput,
  RefreshInput,
  UserClaims,
} from './service.js';
export { createAuthService } from './service.js';
