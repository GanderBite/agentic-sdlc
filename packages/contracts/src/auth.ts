import { z } from 'zod';

// ---------------------------------------------------------------------------
// Branded ID
// ---------------------------------------------------------------------------

export const UserId = z.string().uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;

// ---------------------------------------------------------------------------
// Shared user shape (used in multiple responses)
// ---------------------------------------------------------------------------

const userShape = z.object({
  id: UserId,
  email: z.string().email(),
  role: z.enum(['patient', 'doctor']),
});

export type UserShape = z.infer<typeof userShape>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const loginRequest = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequest>;

export const loginResponse = z.object({
  user: userShape,
});

export type LoginResponse = z.infer<typeof loginResponse>;

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export const meResponse = z.object({
  user: userShape,
});

export type MeResponse = z.infer<typeof meResponse>;

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export const logoutRequest = z.object({}).strict();
export type LogoutRequest = z.infer<typeof logoutRequest>;

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export const refreshRequest = z.object({}).strict();
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const refreshResponse = z.object({
  user: userShape,
});

export type RefreshResponse = z.infer<typeof refreshResponse>;

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export const AuthErrorCode = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'INTERNAL',
]);

export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const errorEnvelope = z.object({
  error: z.object({
    code: AuthErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
