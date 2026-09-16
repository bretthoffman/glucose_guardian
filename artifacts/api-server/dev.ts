/**
 * Local / long-running dev server (not used on Vercel).
 * Vercel uses api/index.cjs + dist/index.cjs instead of scanning TypeScript under src/.
 */
// Local runs read the git-ignored .env.local (CONVEX_*, USDA_FDC_API_KEY, …) the way Vercel injects
// its project variables. Node's loader never overrides a variable already set in the shell, and the
// file is optional. Vercel does not run this file.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — rely on the shell environment */
}

import app from "./internal/app";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
