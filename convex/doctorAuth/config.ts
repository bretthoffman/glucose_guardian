/**
 * Doctor portal sign-in security policy — the single source for its thresholds. Mirrors the
 * Guardian PIN policy (guardianPin/config.ts), with scrypt at OWASP's recommended cost for
 * passwords rather than PINs.
 */
export const DOCTOR_AUTH_CONFIG = {
  /** scrypt parameters (Node crypto) — stored with each digest, so they can be raised later. */
  SCRYPT_N: 131072,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
  SCRYPT_KEYLEN: 32,
  SCRYPT_MAXMEM: 256 * 1024 * 1024,

  /** How long a sign-in lasts, however active the doctor is (the portal's PIN lock covers idle). */
  SESSION_MAX_AGE_MS: 12 * 60 * 60 * 1000,

  /** Invites: single use, tied to one email, and short-lived. */
  INVITE_VALID_MS: 14 * 24 * 60 * 60 * 1000,

  /** License-key sign-up: the emailed code's lifetime and how many guesses it allows. */
  EMAIL_CODE_VALID_MS: 15 * 60 * 1000,
  EMAIL_CODE_MAX_ATTEMPTS: 5,
} as const;

/**
 * Failed-attempt limits. Once `max` failures land inside `windowMs`, the key is locked for
 * `lockMs`. Per-account keys stop guessing one doctor's password; per-IP keys stop one source
 * spraying many accounts or patient codes.
 */
export const THROTTLE_POLICIES = {
  loginEmail: { max: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  loginIp: { max: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  linkDoctor: { max: 10, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  linkIp: { max: 20, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  inviteIp: { max: 10, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  /** Verification emails sent to one address (every send counts, not only failures). */
  emailCodeSend: { max: 5, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
} as const;

export type ThrottlePolicy = keyof typeof THROTTLE_POLICIES;
