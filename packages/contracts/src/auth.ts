import { z } from "zod";

export const Role = z.enum(["patient", "doctor"]);
export type Role = z.infer<typeof Role>;

const userShape = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: Role,
});

export type User = z.infer<typeof userShape>;

export const loginRequest = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export type LoginRequest = z.infer<typeof loginRequest>;

export const loginResponse = z.object({
  user: userShape,
});

export type LoginResponse = z.infer<typeof loginResponse>;

export const refreshResponse = z.object({
  user: userShape,
});

export type RefreshResponse = z.infer<typeof refreshResponse>;

export const meResponse = z.object({
  user: userShape,
});

export type MeResponse = z.infer<typeof meResponse>;

export const logoutResponse = z.object({
  ok: z.literal(true),
});

export type LogoutResponse = z.infer<typeof logoutResponse>;
