"use strict";
/**
 * CJS shim for ESM-only `node-fetch@3` when the server bundle is `format: "cjs"`.
 * Node 18+ and Vercel provide native `fetch`.
 */
module.exports = globalThis.fetch;
