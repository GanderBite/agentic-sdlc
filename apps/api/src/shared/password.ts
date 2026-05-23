import argon2 from 'argon2';

export async function hash(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

export async function verify(hash: string, plaintext: string): Promise<boolean> {
  return argon2.verify(hash, plaintext);
}

export type PasswordVerifier = {
  verify: (hash: string, plaintext: string) => Promise<boolean>;
};

export function createPasswordVerifier(
  impl?: (hash: string, plaintext: string) => Promise<boolean>,
): PasswordVerifier {
  return {
    verify: impl ?? verify,
  };
}
