export const LIBRE_DEFAULT_BASE = "https://api.libreview.io";

/**
 * Base headers every LibreLinkUp request must carry — this is what makes Abbott accept us as the
 * official app. LibreLinkUp rejects older app versions (status 920) and, since Oct 2025, needs
 * 4.16+ plus the Account-Id header on connections/graph calls (see libreAccountIdHash).
 * product/version/User-Agent are env-overridable because Abbott periodically raises the minimum
 * version — a Vercel env change fixes prod without a deploy.
 * Keep in sync with `convex/cgm/providers.ts` + `convex/cgm/config.ts` (same env var names).
 */
export function libreHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json;charset=UTF-8",
    Accept: "application/json",
    "Cache-Control": "no-cache",
    product: process.env.LIBRE_LLU_PRODUCT?.trim() || "llu.ios",
    version: process.env.LIBRE_LLU_VERSION?.trim() || "4.16.0",
    "User-Agent":
      process.env.LIBRE_LLU_USER_AGENT?.trim() ||
      "Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25",
  };
}

/** `Account-Id` header value: SHA-256 hex of the LibreLinkUp user id. */
export async function libreAccountIdHash(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type LibreLinkLoginResult =
  | { ok: true; token: string; accountId?: string; accountIdHash?: string; apiBase: string }
  | { ok: false; httpStatus: number; error: string };

/**
 * Login can answer `status: 4` ("account action required"): new terms of use or privacy policy are
 * pending for the follower account, and every API login is blocked until they are accepted. The
 * response names the step (`data.step.type`: "tou" | "pp") and carries a step token; accepting is a
 * bare POST to `/auth/continue/<type>` with that token, which answers with a fresh login payload.
 * Bounded to two steps (tou, then pp); anything unexpected returns the last payload unchanged so the
 * caller falls back to the "sign in to the LibreLinkUp app once" message.
 */
async function libreAcceptPendingSteps(
  base: string,
  data: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 2 && data?.status === 4; i++) {
    const d = data.data as { step?: { type?: string }; authTicket?: { token?: string } } | undefined;
    const stepType = d?.step?.type;
    const stepToken = d?.authTicket?.token;
    if (!stepToken || (stepType !== "tou" && stepType !== "pp")) break;
    const resp = await fetch(`${base}/auth/continue/${stepType}`, {
      method: "POST",
      headers: { ...libreHeaders(), Authorization: `Bearer ${stepToken}` },
    });
    if (!resp.ok) break;
    const text = await resp.text();
    let next: Record<string, unknown> | null = null;
    try {
      next = JSON.parse(text) as Record<string, unknown>;
    } catch {
      break;
    }
    data = next;
  }
  return data;
}

/**
 * Authenticate against LibreLink Up and obtain a bearer token.
 * Same behavior as the legacy `/libre/connect` route (messages preserved).
 */
export async function libreLinkLogin(input: {
  email: string;
  password: string;
  apiBase?: string;
}): Promise<LibreLinkLoginResult> {
  const email = input.email?.trim();
  const password = input.password;
  if (!email || !password) {
    return { ok: false, httpStatus: 400, error: "Email and password required" };
  }

  let apiBase = (input.apiBase?.trim() || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
  const loginBody = JSON.stringify({ email, password });

  const attemptLogin = async (base: string) => {
    const loginUrl = `${base}/llu/auth/login`;
    const loginResp = await fetch(loginUrl, {
      method: "POST",
      headers: libreHeaders(),
      body: loginBody,
    });
    const loginText = await loginResp.text();
    let loginData: Record<string, unknown> | null = null;
    try {
      loginData = JSON.parse(loginText) as Record<string, unknown>;
    } catch {
      loginData = null;
    }
    return { loginResp, loginData, loginText };
  };

  let { loginResp, loginData } = await attemptLogin(apiBase);

  // Regional redirect (`data.redirect` + `region`): switch host and retry, capped at 2 hops.
  for (
    let hop = 0;
    hop < 2 && loginData?.status === 2 && (loginData.data as Record<string, unknown> | undefined)?.redirect === true;
    hop++
  ) {
    const region = String((loginData.data as { region?: string })?.region ?? "us");
    apiBase = `https://api.${region}.libreview.io`;
    ({ loginResp, loginData } = await attemptLogin(apiBase));
  }

  if (!loginResp.ok) {
    const msg =
      (loginData?.message as string | undefined) ??
      (loginData?.error as string | undefined) ??
      "Invalid LibreLink credentials. Check your email and password.";
    return { ok: false, httpStatus: 401, error: msg };
  }

  // LibreLinkUp answers HTTP 200 with a status code in the body.
  if (loginData?.status === 2) {
    return { ok: false, httpStatus: 401, error: "Wrong email or password. Use the email and password you sign in to the LibreLinkUp app with." };
  }
  if (loginData?.status === 4) {
    loginData = await libreAcceptPendingSteps(apiBase, loginData);
  }
  if (loginData?.status === 4) {
    return { ok: false, httpStatus: 409, error: "LibreLinkUp needs you to accept its updated terms. Open the LibreLinkUp app, sign in, tap Accept, then try again here." };
  }
  if (loginData?.status === 920) {
    return { ok: false, httpStatus: 502, error: "LibreLinkUp asked for a newer app version. Please let us know so we can update." };
  }

  const token = (loginData?.data as { authTicket?: { token?: string } } | undefined)?.authTicket?.token;
  if (!token) {
    return {
      ok: false,
      httpStatus: 401,
      error:
        "Could not authenticate with LibreLink Up. Make sure LibreLinkUp Sharing is enabled in your LibreLink app.",
    };
  }

  const accountId = (loginData?.data as { user?: { id?: string } } | undefined)?.user?.id;
  const accountIdHash = accountId ? await libreAccountIdHash(accountId) : undefined;

  return { ok: true, token, accountId, accountIdHash, apiBase };
}

/**
 * How many people this LibreLinkUp account follows. 0 = signed in fine but nobody has shared with
 * it yet (the usual "connected but no data" cause). null = couldn't check (don't block on it).
 */
export async function libreConnectionCount(login: { token: string; apiBase: string; accountIdHash?: string }): Promise<number | null> {
  try {
    const resp = await fetch(`${login.apiBase.replace(/\/$/, "")}/llu/connections`, {
      headers: {
        ...libreHeaders(),
        Authorization: `Bearer ${login.token}`,
        ...(login.accountIdHash ? { "Account-Id": login.accountIdHash } : {}),
      },
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { data?: { patientId?: string }[] };
    return (body?.data ?? []).filter((p) => Boolean(p?.patientId)).length;
  } catch {
    return null;
  }
}

/** `"M/D/YYYY h:mm:ss AM"` — the shape LibreLinkUp uses for both of its timestamp fields. */
const LIBRE_TS_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

/**
 * LibreLinkUp timestamps are wall-clock strings with NO timezone suffix. `FactoryTimestamp` is UTC;
 * parsed explicitly (never via `new Date(string)`) so the host timezone can never shift readings.
 * Numeric input is tolerated as epoch seconds (the legacy assumed shape). Returns epoch ms or null.
 * Mirrors `convex/cgm/providers.ts` — keep in sync so dedupe keys match across both writers.
 */
export function parseLibreUtcTimestamp(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw > 1e11 ? raw : raw * 1000; // > 1e11 can only be milliseconds already
  }
  if (typeof raw !== "string") return null;
  const m = LIBRE_TS_RE.exec(raw.trim());
  if (m) {
    const [, month, day, year, hour12, minute, second, ampm] = m;
    let hour = parseInt(hour12!, 10) % 12; // "12:xx AM" → 0
    if (/pm/i.test(ampm!)) hour += 12;
    const ms = Date.UTC(+year!, +month! - 1, +day!, hour, +minute!, +second!);
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(raw);
  return /\d[Tt ]\d.*(Z|[+-]\d{2}:?\d{2})$/.test(raw.trim()) && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Libre `TrendArrow` (1 = falling fast … 5 = rising fast) → the Dexcom trend scale (1 = DoubleUp …
 * 7 = DoubleDown) the clients interpret. Raw Libre values would read INVERTED downstream; Libre has
 * no double-arrow state, so extremes map to SingleUp/SingleDown. Mirrors `convex/cgm/providers.ts`.
 */
const LIBRE_TO_DEXCOM_TREND: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 3, 5: 2 };

export function libreTrendToDexcom(trend: unknown): number | undefined {
  return LIBRE_TO_DEXCOM_TREND[Number(trend)];
}

export interface LibreNormalizedReading {
  glucose: number;
  timestamp: string;
  trend?: number;
}

/**
 * Normalizes one LibreLinkUp glucose item (`graphData[]` row or `connection.glucoseMeasurement`).
 * Returns null for rows lacking a usable timestamp/value. `Value` (display units) is only trusted
 * when `GlucoseUnits` is 1 (mg/dL) — a mmol/L value stored as mg/dL would read ~18× low.
 */
export function normalizeLibreGraphItem(item: Record<string, unknown>): LibreNormalizedReading | null {
  const ms =
    parseLibreUtcTimestamp(item.FactoryTimestamp) ??
    (typeof item.Timestamp === "number" ? parseLibreUtcTimestamp(item.Timestamp) : null);
  const mgdl = Number(item.ValueInMgPerDl);
  const displayValue = Number(item.Value);
  const glucose = Number.isFinite(mgdl) && mgdl > 0
    ? mgdl
    : item.GlucoseUnits === 1 && Number.isFinite(displayValue) && displayValue > 0
      ? displayValue
      : NaN;
  if (ms === null || !Number.isFinite(glucose)) return null;
  const trend = libreTrendToDexcom(item.TrendArrow);
  return { glucose, timestamp: new Date(ms).toISOString(), ...(trend != null ? { trend } : {}) };
}
