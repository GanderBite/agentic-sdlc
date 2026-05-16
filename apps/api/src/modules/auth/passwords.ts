import argon2 from 'argon2';

// ---------------------------------------------------------------------------
// PasswordHasher — DI interface consumed by auth.service
// Production wires defaultPasswordHasher; tests inject a spy implementation.
// ---------------------------------------------------------------------------

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// OWASP-minimum argon2id parameters (ARCHITECTURE §5.4)
//   memoryCost  = 19 456 KiB (~19 MiB)
//   timeCost    = 2 iterations
//   parallelism = 1 thread
// ---------------------------------------------------------------------------

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const defaultPasswordHasher: PasswordHasher = {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2ID_OPTIONS);
  },

  async verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  },
};
