/**
 * Vercel serverless entry: loads the pre-bundled Express app (dist/index.cjs).
 * Pure JS so Vercel does not run a second TypeScript compile on route modules.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("../dist/index.cjs");
export default mod.default ?? mod;
