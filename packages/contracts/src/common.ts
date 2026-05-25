import { z } from 'zod';

export const ErrorCode = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'TOO_MANY_REQUESTS',
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'UNSUPPORTED_MEDIA',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const errorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
