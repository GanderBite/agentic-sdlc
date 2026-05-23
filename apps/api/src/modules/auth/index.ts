// Public surface of the auth module.
// Only re-export the factory and the types that other modules or the route
// layer need.  Repo internals, schema, and throttle remain private.

export { createAuthService } from "./service.js";
export type {
  AuthService,
  AuthServiceDeps,
  AuthTokens,
  LoginInput,
  LogoutInput,
  RefreshInput,
  UserClaims,
  Logger as AuthLogger,
} from "./service.js";
