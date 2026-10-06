"use node";

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { DOCTOR_AUTH_CONFIG as C } from "./config";

/**
 * A doctor's password digest: scrypt over the secret the portal sends, with a random salt and
 * the cost recorded alongside — `scrypt$N$r$p$salt$hash` (base64) — so the cost can be raised
 * later without breaking accounts hashed at the old one.
 */
export function hashDoctorPassword(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, C.SCRYPT_KEYLEN, {
    N: C.SCRYPT_N,
    r: C.SCRYPT_R,
    p: C.SCRYPT_P,
    maxmem: C.SCRYPT_MAXMEM,
  });
  return ["scrypt", C.SCRYPT_N, C.SCRYPT_R, C.SCRYPT_P, salt.toString("base64"), hash.toString("base64")].join(
    "$",
  );
}

export function verifyDoctorPassword(secret: string, digest: string): boolean {
  const [scheme, n, r, p, salt, hash] = digest.split("$");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (scheme !== "scrypt" || !salt || !hash || ![N, R, P].every(Number.isInteger)) return false;
  const expected = Buffer.from(hash, "base64");
  const derived = scryptSync(secret, Buffer.from(salt, "base64"), expected.length, {
    N,
    r: R,
    p: P,
    maxmem: Math.max(C.SCRYPT_MAXMEM, 256 * N * R),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Constant-time check against an account still on the pre-scrypt stored value. */
export function legacyPasswordMatches(secret: string, stored: string): boolean {
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(stored).digest();
  return timingSafeEqual(a, b);
}

let dummyDigest: string | null = null;

/** The same work as a real check, so response time doesn't reveal which emails have accounts. */
export function burnPasswordCheck(secret: string): void {
  dummyDigest ??= hashDoctorPassword("no-such-account");
  verifyDoctorPassword(secret, dummyDigest);
}

/** Unambiguous characters (no 0/O, 1/I/L) — invites get read aloud and typed. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A fresh invite code, `XXXX-XXXX-XXXX` (12 characters, ~59 bits). */
export function newInviteCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Invites are stored by hash only — the code itself is shown once, when it's created. */
export function inviteCodeHash(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}
