"use node";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { GUARDIAN_PIN_CONFIG as C } from "./config";

export function hashGuardianPin(pin: string): { pinHash: string; pinSalt: string } {
  const saltBuf = randomBytes(16);
  const derived = scryptSync(pin, saltBuf, C.SCRYPT_KEYLEN, {
    N: C.SCRYPT_N,
    r: C.SCRYPT_R,
    p: C.SCRYPT_P,
    maxmem: C.SCRYPT_MAXMEM,
  });
  return {
    pinHash: derived.toString("base64"),
    pinSalt: saltBuf.toString("base64"),
  };
}

export function verifyGuardianPinHash(pin: string, pinHash: string, pinSalt: string): boolean {
  const saltBuf = Buffer.from(pinSalt, "base64");
  const expected = Buffer.from(pinHash, "base64");
  const derived = scryptSync(pin, saltBuf, expected.length, {
    N: C.SCRYPT_N,
    r: C.SCRYPT_R,
    p: C.SCRYPT_P,
    maxmem: C.SCRYPT_MAXMEM,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
