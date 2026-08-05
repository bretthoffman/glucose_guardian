import * as Crypto from "expo-crypto";

/**
 * Alphabet for shareable 6-character access codes. Deliberately excludes I, O, 0, 1 so a code read
 * aloud or copied off a screen can't be mistyped. 32 symbols ⇒ exactly 5 bits per character.
 */
export const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ACCESS_CODE_LENGTH = 6;

/**
 * Generate an access code using a CRYPTOGRAPHIC random source.
 *
 * Why this matters more than it looks: for `POST /api/doctor/sync` and
 * `POST /api/doctor/order-decision`, the 6-char code is the ONLY credential — those two routes carry
 * no auth middleware, and CORS is open, so the code alone gates reading a patient's clinical snapshot
 * and approving a clinician's insulin-dose change. These were previously built with `Math.random()`,
 * which is seeded PRNG output, not unpredictable: given enough observed codes an attacker can
 * recover the generator state and predict future ones. 32^6 ≈ 1.07 billion is a reasonable keyspace
 * ONLY if the draws are actually random.
 *
 * `getRandomBytes` is backed by the platform CSPRNG (SecRandomCopyBytes / OpenSSL).
 *
 * Rejection sampling, not modulo: 256 is 8× 32 exactly, so `byte % 32` happens to be unbiased for
 * this alphabet — but that is a property of the length, not of the code. Discarding the (here empty)
 * out-of-range tail keeps it correct if the alphabet is ever edited.
 */
export function generateAccessCode(length: number = ACCESS_CODE_LENGTH): string {
  const alphabet = ACCESS_CODE_ALPHABET;
  const limit = Math.floor(256 / alphabet.length) * alphabet.length; // largest unbiased multiple
  let out = "";
  while (out.length < length) {
    const bytes = Crypto.getRandomBytes(length - out.length + 8); // slack so refills are rare
    for (const b of bytes) {
      if (out.length >= length) break;
      if (b >= limit) continue; // biased tail — draw again
      out += alphabet[b % alphabet.length];
    }
  }
  return out;
}
