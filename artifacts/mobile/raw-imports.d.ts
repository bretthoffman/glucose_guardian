/**
 * Vite/Vitest `?raw` imports return a module's source as a string. Used by
 * `utils/identityBoundaryKeys.test.ts`, which inspects AuthContext's source to enforce that every
 * persisted storage key has an identity-boundary clearing decision. Declared here so `tsc` accepts
 * the suffix — the transform itself is provided by the bundler, not by TypeScript.
 */
declare module "*?raw" {
  const source: string;
  export default source;
}
