import {
  type LoginRequest,
  type LoginResponse,
  type LogoutResponse,
  loginRequest,
  loginResponse,
  logoutResponse,
  type MeResponse,
  meResponse,
  type RefreshResponse,
  refreshResponse,
} from '@medbridge/contracts';

import { request } from './client';

/**
 * Typed auth API wrappers.
 * Each function returns the Zod-parsed contract type.
 * All requests use credentials:'include' (via the shared fetch wrapper) so
 * cookies (session, refresh_token, csrf_token) flow automatically.
 */
export const api = {
  /**
   * POST /api/login — issues session, refresh_token, and csrf_token cookies.
   * CSRF-exempt on the server side (no prior token exists yet).
   */
  async login(body: LoginRequest): Promise<LoginResponse> {
    return request(
      '/api/login',
      {
        method: 'POST',
        body: JSON.stringify(loginRequest.parse(body)),
      },
      loginResponse,
    );
  },

  /**
   * POST /api/refresh — rotates all three auth cookies.
   * CSRF-exempt on the server side.
   * NOTE: called internally by the client's single-flight 401 handler;
   * callers may also invoke it proactively.
   */
  async refresh(): Promise<RefreshResponse> {
    return request('/api/refresh', { method: 'POST' }, refreshResponse);
  },

  /**
   * POST /api/logout — revokes the refresh token and clears all auth cookies.
   * CSRF required (X-CSRF-Token header is added automatically by the client).
   */
  async logout(): Promise<LogoutResponse> {
    return request('/api/logout', { method: 'POST' }, logoutResponse);
  },

  /**
   * GET /api/me — returns the authenticated user from the current session.
   */
  async me(): Promise<MeResponse> {
    return request('/api/me', { method: 'GET' }, meResponse);
  },
} as const;
