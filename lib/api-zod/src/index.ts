/**
 * Zod schemas from Orval (`generated/api.ts`).
 *
 * We intentionally do not `export *` from `./generated/types` here: Orval also emits
 * TypeScript interfaces with the same names as some Zod exports (e.g. `DoctorLoginResponse`),
 * which makes `export *` from both barrels invalid (TS2308) and breaks downstream imports.
 *
 * Import TS-only types from `@workspace/api-zod/types` if needed.
 */
export * from "./generated/api";
