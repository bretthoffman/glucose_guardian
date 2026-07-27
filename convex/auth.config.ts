/**
 * Identity providers Convex will trust (see PREBUILD_PLAN_01 §3).
 *
 * `domain` is the Clerk instance's Frontend API URL; Convex fetches its public JWKS from there to
 * verify every incoming token, which is why no Clerk SECRET key is needed anywhere in this project.
 * `applicationID` must match the name of the JWT template configured in the Clerk dashboard — it has
 * to be literally "convex", and the app requests tokens with `getToken({ template: "convex" })`.
 *
 * Set `CLERK_JWT_ISSUER_DOMAIN` per deployment (Convex dashboard / `npx convex env set`):
 *   development instance → https://next-osprey-15.clerk.accounts.dev
 *   production instance  → https://clerk.<your-domain> (requires a domain + DNS, see the plan)
 *
 * Kept as an env var rather than hard-coded so the same code serves both instances, and so swapping
 * dev → production Clerk before shipping is a config change with no redeploy of app code.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
