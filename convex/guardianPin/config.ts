/** Guardian PIN security policy — single source for thresholds (not scattered in handlers). */
export const GUARDIAN_PIN_CONFIG = {
  /** scrypt parameters (Node crypto) — version 1 */
  HASH_VERSION: 1,
  SCRYPT_N: 16384,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
  SCRYPT_KEYLEN: 32,
  SCRYPT_MAXMEM: 64 * 1024 * 1024,

  /** Failed verification attempts before temporary lockout */
  MAX_FAILED_ATTEMPTS: 5,
  /** Lockout duration after threshold exceeded (ms) */
  LOCKOUT_MS: 15 * 60 * 1000,
} as const;
