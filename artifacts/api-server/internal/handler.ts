/**
 * Production bundle entry for esbuild → dist/index.cjs.
 * Exports the Express app only (no listen). Vercel loads this via api/index.cjs.
 */
import app from "./app";

export default app;
