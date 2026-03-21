/**
 * Local / long-running dev server (not used on Vercel).
 * Vercel uses api/index.cjs + dist/index.cjs instead of scanning TypeScript under src/.
 */
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
