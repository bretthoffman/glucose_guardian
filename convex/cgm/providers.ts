/**
 * Provider protocol adapters — the ONLY place Dexcom Share / LibreLink Up HTTP logic lives.
 *
 * Each adapter exposes the same `login` / `read` shape (consumed generically by `runProviderSync`)
 * but keeps provider-specific authentication and response parsing isolated. `fetch` is injectable so
 * the adapters are testable with a fake transport and no live credentials. All network/HTTP errors
 * are mapped to the sanitized `FailureCategory` taxonomy; no raw error text escapes.
 */
import {
  anomalyFor,
  type FailureCategory,
  type FetchPlan,
  type LoginOutcome,
  type ProviderLimits,
  type Provider,
  type ReadingRecord,
  type ReadOutcome,
} from "./core";
import { libreLluConfig, PROVIDER_LIMITS } from "./config";
import {
  type LibreDiagnosticSummary,
  type ProviderDiagnosticCategory,
  diagnosticMessageKey,
  failureCategoryToDiagnostic,
  reconnectRequiredForDiagnostic,
  retryableForDiagnostic,
} from "./diagnostics";

type FetchLike = typeof fetch;

export interface ProviderAdapter<Creds, Session> {
  provider: Provider;
  limits: ProviderLimits;
  login(creds: Creds): Promise<LoginOutcome<Session>>;
  read(session: Session, plan: FetchPlan): Promise<ReadOutcome>;
}

function httpTransientCategory(status: number): FailureCategory {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_outage";
  return "internal_error";
}

/* --------------------------------- Dexcom --------------------------------- */

export interface DexcomCreds {
  username: string;
  password: string;
  outsideUS: boolean;
}
export interface DexcomSession {
  sessionId: string;
  outsideUS: boolean;
}

const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";
const DEXCOM_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/978.0.7 Darwin/18.7.0",
} as const;
const DEXCOM_APP_ID = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

/** Dexcom error `Code`s that mean the user must fix their credentials (terminal until reconnect). */
const DEXCOM_INVALID_CRED_CODES = new Set(["AccountPasswordInvalid", "AccountNotFound"]);

export function makeDexcomAdapter(deps?: { fetch?: FetchLike }): ProviderAdapter<DexcomCreds, DexcomSession> {
  const doFetch: FetchLike = deps?.fetch ?? fetch;
  const baseFor = (outsideUS: boolean) => (outsideUS ? DEXCOM_BASE_OUS : DEXCOM_BASE);

  return {
    provider: "dexcom",
    limits: PROVIDER_LIMITS.dexcom,

    async login(creds: DexcomCreds): Promise<LoginOutcome<DexcomSession>> {
      if (!creds.username || !creds.password) return { ok: false, category: "no_credentials" };
      const base = baseFor(creds.outsideUS);
      try {
        const authResp = await doFetch(`${base}/General/AuthenticatePublisherAccount`, {
          method: "POST",
          headers: DEXCOM_HEADERS,
          body: JSON.stringify({
            accountName: creds.username,
            password: creds.password,
            applicationId: DEXCOM_APP_ID,
          }),
        });
        const authText = await authResp.text();
        if (!authResp.ok) return { ok: false, category: classifyDexcomAuthError(authResp.status, authText) };

        let accountId: string;
        try {
          accountId = JSON.parse(authText) as string;
        } catch {
          accountId = authText.replace(/^"|"$/g, "").trim();
        }
        if (!accountId || typeof accountId !== "string" || accountId.length < 10) {
          return { ok: false, category: "malformed_response" };
        }

        const loginResp = await doFetch(`${base}/General/LoginPublisherAccountById`, {
          method: "POST",
          headers: DEXCOM_HEADERS,
          body: JSON.stringify({ accountId, password: creds.password, applicationId: DEXCOM_APP_ID }),
        });
        const loginText = await loginResp.text();
        if (!loginResp.ok) return { ok: false, category: classifyDexcomAuthError(loginResp.status, loginText) };

        let sessionId: string;
        try {
          sessionId = JSON.parse(loginText) as string;
        } catch {
          sessionId = loginText.replace(/^"|"$/g, "").trim();
        }
        if (!sessionId || typeof sessionId !== "string" || sessionId.length < 10) {
          return { ok: false, category: "malformed_response" };
        }
        return { ok: true, session: { sessionId, outsideUS: creds.outsideUS } };
      } catch {
        return { ok: false, category: "network_timeout" };
      }
    },

    async read(session: DexcomSession, plan: FetchPlan): Promise<ReadOutcome> {
      const base = baseFor(session.outsideUS);
      const url =
        `${base}/Publisher/ReadPublisherLatestGlucoseValues` +
        `?sessionId=${encodeURIComponent(session.sessionId)}` +
        `&minutes=${plan.windowMinutes}&maxCount=${plan.count}`;
      try {
        const resp = await doFetch(url, { method: "GET", headers: DEXCOM_HEADERS });
        const rawText = await resp.text();
        if (!resp.ok) {
          const expired = resp.status === 401 || /SessionNotValid|session/i.test(rawText);
          return { ok: false, sessionExpired: expired, category: expired ? "none" : httpTransientCategory(resp.status) };
        }
        let data: unknown;
        try {
          data = JSON.parse(rawText);
        } catch {
          return { ok: false, sessionExpired: false, category: "malformed_response" };
        }
        if (!Array.isArray(data)) {
          const expired = typeof data === "string" && /SessionNotValid|session/i.test(data);
          return {
            ok: false,
            sessionExpired: expired,
            category: expired ? "none" : "malformed_response",
          };
        }
        return { ok: true, entries: data.map(normalizeDexcomReading) };
      } catch {
        return { ok: false, sessionExpired: false, category: "network_timeout" };
      }
    },
  };
}

function classifyDexcomAuthError(status: number, body: string): FailureCategory {
  try {
    const parsed = JSON.parse(body) as { Code?: string };
    if (parsed?.Code && DEXCOM_INVALID_CRED_CODES.has(parsed.Code)) return "invalid_credentials";
    if (parsed?.Code === "AccountLockout") return "rate_limited"; // temporary lockout — back off, don't reconnect
  } catch {
    /* fall through to status-based classification */
  }
  if (status === 401 || status === 400) return "invalid_credentials";
  return httpTransientCategory(status);
}

/** Mirrors the api-server `/dexcom/readings` mapping so dedupe keys match the client path exactly. */
function normalizeDexcomReading(item: Record<string, unknown>): ReadingRecord {
  let timestamp: string;
  try {
    const raw = (item.ST ?? item.WT ?? "") as string;
    const match = String(raw).match(/Date\((\d+)/);
    const ms = match ? parseInt(match[1]!, 10) : NaN;
    timestamp = Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
  } catch {
    timestamp = new Date().toISOString();
  }
  const glucose = (item.Value ?? item.value ?? 0) as number;
  const trend = (item.Trend ?? item.trend ?? 0) as number | string;
  const entry: ReadingRecord = { glucose, timestamp, anomaly: anomalyFor(glucose) };
  if (trend != null) entry.dexcomTrend = trend;
  return entry;
}

/* ---------------------------------- Libre --------------------------------- */

export interface LibreCreds {
  email: string;
  password: string;
  apiBase?: string;
}
export interface LibreSession {
  token: string;
  apiBase: string;
  /**
   * SHA-256 (hex) of the LibreLinkUp user id. Required as the `Account-Id` header on connections and
   * graph calls since LibreLinkUp 4.16 (Oct 2025); without it those calls fail with 403, which counts
   * as an expired session, so a session saved before this change logs in once more and gets it.
   */
  accountId?: string;
}

/** `Account-Id` header value: SHA-256 hex of the LibreLinkUp user id (Web Crypto: Convex and Node). */
export async function libreAccountIdHash(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const LIBRE_DEFAULT_BASE = "https://api.libreview.io";

/**
 * Base headers every LibreLinkUp request must carry — this is what makes Abbott accept us as the
 * official app. LibreLinkUp rejects older app versions (status 920) and, since Oct 2025, needs
 * 4.16+ with the Account-Id header on data calls. product/version/User-Agent are env-overridable
 * (`libreLluConfig`) because Abbott periodically raises the minimum version.
 * Keep in sync with `artifacts/api-server/internal/libre-link-login.ts`.
 */
function libreBaseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json;charset=UTF-8",
    Accept: "application/json",
    "Cache-Control": "no-cache",
    product: libreLluConfig.product,
    version: libreLluConfig.version,
    "User-Agent": libreLluConfig.userAgent,
  };
}

type LibreLoginAttempt = {
  ok: true;
  token: string;
  apiBase: string;
  accountId?: string;
  regionResolved: boolean;
};
type LibreLoginFailure = { ok: false; category: FailureCategory };

function apiHostLabel(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return "unknown";
  }
}

/**
 * Login can answer `status: 4` ("account action required"): new terms of use or privacy policy are
 * pending for the follower account, and every API login is blocked until they are accepted. The
 * response names the step (`data.step.type`: "tou" | "pp") and carries a step token; accepting is a
 * bare POST to `/auth/continue/<type>` with that token, which answers with a fresh login payload.
 * Bounded to two steps (tou, then pp); anything unexpected returns the last payload unchanged so the
 * caller falls back to the "sign in to the LibreLinkUp app once" path.
 */
async function libreAcceptPendingSteps(
  doFetch: FetchLike,
  base: string,
  data: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 2 && data?.status === 4; i++) {
    const d = data.data as { step?: { type?: string }; authTicket?: { token?: string } } | undefined;
    const stepType = d?.step?.type;
    const stepToken = d?.authTicket?.token;
    if (!stepToken || (stepType !== "tou" && stepType !== "pp")) break;
    const resp = await doFetch(`${base}/auth/continue/${stepType}`, {
      method: "POST",
      headers: { ...libreBaseHeaders(), Authorization: `Bearer ${stepToken}` },
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

async function libreAttemptLogin(
  doFetch: FetchLike,
  creds: LibreCreds,
): Promise<LibreLoginAttempt | LibreLoginFailure> {
  if (!creds.email || !creds.password) return { ok: false, category: "no_credentials" };
  let base = (creds.apiBase?.trim() || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
  const body = JSON.stringify({ email: creds.email.trim(), password: creds.password });
  let regionResolved = Boolean(creds.apiBase?.trim());

  const attempt = async (b: string) => {
    const resp = await doFetch(`${b}/llu/auth/login`, {
      method: "POST",
      headers: libreBaseHeaders(),
      body,
    });
    const text = await resp.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }
    return { resp, data };
  };

  let { resp, data } = await attempt(base);
  // Regional redirect (`data.redirect` + `region`): switch host and retry, capped at 2 hops.
  for (
    let hop = 0;
    hop < 2 && data?.status === 2 && (data.data as Record<string, unknown> | undefined)?.redirect === true;
    hop++
  ) {
    const region = String((data.data as { region?: string })?.region ?? "us");
    base = `https://api.${region}.libreview.io`;
    regionResolved = true;
    ({ resp, data } = await attempt(base));
  }
  if (!resp.ok) {
    return {
      ok: false,
      category: resp.status === 401 ? "invalid_credentials" : httpTransientCategory(resp.status),
    };
  }
  // status 2 without a redirect = wrong email or password (LibreLinkUp answers HTTP 200).
  if (data?.status === 2) return { ok: false, category: "invalid_credentials" };

  data = await libreAcceptPendingSteps(doFetch, base, data);
  if (data?.status === 4) {
    // Terms still pending (auto-accept failed). The status-4 payload DOES carry a token, but it is
    // the step token, not a data-call token — treating it as a session would "succeed" here and then
    // fail every data call. User fix: sign in to the LibreLinkUp app once and tap Accept.
    return { ok: false, category: "sharing_not_enabled" };
  }
  if (data?.status === 920) {
    // Our client version is below Abbott's minimum — an operator problem (bump LIBRE_LLU_VERSION in
    // the deployment env), never the user's: back off instead of demanding a reconnect.
    console.warn("[libre] login rejected: below minimum app version (status 920)");
    return { ok: false, category: "provider_outage" };
  }

  const token = (data?.data as { authTicket?: { token?: string } } | undefined)?.authTicket?.token;
  if (!token) {
    // Account not ready to follow (no share token on an otherwise-successful login).
    return { ok: false, category: "sharing_not_enabled" };
  }
  const userId = (data?.data as { user?: { id?: string } } | undefined)?.user?.id;
  const accountId = userId ? await libreAccountIdHash(userId) : undefined;
  return { ok: true, token, apiBase: base, accountId, regionResolved };
}

function libreAuthHeaders(session: LibreSession): Record<string, string> {
  return {
    ...libreBaseHeaders(),
    Authorization: `Bearer ${session.token}`,
    ...(session.accountId ? { "Account-Id": session.accountId } : {}),
  };
}

type LibreConnectionsResult =
  | { ok: true; connectionCount: number; patientId: string | null }
  | { ok: false; sessionExpired: boolean; category: FailureCategory };

async function libreFetchConnections(
  doFetch: FetchLike,
  session: LibreSession,
): Promise<LibreConnectionsResult> {
  const base = (session.apiBase || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
  const connResp = await doFetch(`${base}/llu/connections`, { headers: libreAuthHeaders(session) });
  if (!connResp.ok) {
    // Status code only — never response bodies, tokens, or credentials.
    console.warn(`[libre] connections HTTP ${connResp.status}`);
    return {
      ok: false,
      // 403 = token/Account-Id no longer accepted: a fresh login fixes it, same as 401.
      sessionExpired: connResp.status === 401 || connResp.status === 403,
      category: connResp.status === 401 || connResp.status === 403 ? "none" : httpTransientCategory(connResp.status),
    };
  }
  const connections = (await connResp.json()) as { data?: { patientId?: string }[] };
  const patients = (connections?.data ?? []).filter((p) => Boolean(p?.patientId));
  return {
    ok: true,
    connectionCount: patients.length,
    patientId: patients[0]?.patientId ?? null,
  };
}

type LibreGraphResult =
  | { ok: true; entries: ReadingRecord[] }
  | { ok: false; sessionExpired: boolean; category: FailureCategory };

async function libreFetchGraph(
  doFetch: FetchLike,
  session: LibreSession,
  patientId: string,
): Promise<LibreGraphResult> {
  const base = (session.apiBase || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
  const graphResp = await doFetch(`${base}/llu/connections/${patientId}/graph`, { headers: libreAuthHeaders(session) });
  if (!graphResp.ok) {
    console.warn(`[libre] graph HTTP ${graphResp.status}`);
    return {
      ok: false,
      sessionExpired: graphResp.status === 401 || graphResp.status === 403,
      category: graphResp.status === 401 || graphResp.status === 403 ? "none" : httpTransientCategory(graphResp.status),
    };
  }
  const graphData = (await graphResp.json()) as {
    data?: {
      connection?: { glucoseMeasurement?: Record<string, unknown> };
      graphData?: Record<string, unknown>[];
    };
  };
  const raw = graphData?.data?.graphData ?? [];
  const entries: ReadingRecord[] = [];
  for (const item of raw) {
    const entry = normalizeLibreReading(item);
    if (entry) entries.push(entry);
  }
  // `connection.glucoseMeasurement` is the CURRENT reading — `graphData` lags several minutes behind
  // it, so without it the freshest point (the one alerts fire on) would never be ingested. The
  // timestamp-keyed dedupe in `insertReadings` absorbs any overlap with graphData.
  const current = graphData?.data?.connection?.glucoseMeasurement;
  if (current) {
    const entry = normalizeLibreReading(current);
    if (entry) entries.push(entry);
  }
  return { ok: true, entries };
}

export function makeLibreAdapter(deps?: { fetch?: FetchLike }): ProviderAdapter<LibreCreds, LibreSession> {
  const doFetch: FetchLike = deps?.fetch ?? fetch;

  return {
    provider: "libre",
    limits: PROVIDER_LIMITS.libre,

    async login(creds: LibreCreds): Promise<LoginOutcome<LibreSession>> {
      try {
        const result = await libreAttemptLogin(doFetch, creds);
        if (!result.ok) return result;
        return { ok: true, session: { token: result.token, apiBase: result.apiBase, accountId: result.accountId } };
      } catch {
        return { ok: false, category: "network_timeout" };
      }
    },

    // Libre `/graph` returns a fixed recent window; `plan` count/window are ignored by design.
    async read(session: LibreSession): Promise<ReadOutcome> {
      try {
        const conn = await libreFetchConnections(doFetch, session);
        if (!conn.ok) {
          return {
            ok: false,
            sessionExpired: conn.sessionExpired,
            category: conn.category,
          };
        }
        if (!conn.patientId) {
          return {
            ok: true,
            entries: [],
            readKind: "no_shared_patient",
            connectionCount: conn.connectionCount,
          };
        }

        const graph = await libreFetchGraph(doFetch, session, conn.patientId);
        if (!graph.ok) {
          return {
            ok: false,
            sessionExpired: graph.sessionExpired,
            category: graph.category,
          };
        }
        if (graph.entries.length === 0) {
          return {
            ok: true,
            entries: [],
            readKind: "connected_no_data",
            connectionCount: conn.connectionCount,
          };
        }
        return {
          ok: true,
          entries: graph.entries,
          readKind: "readings",
          connectionCount: conn.connectionCount,
        };
      } catch {
        return { ok: false, sessionExpired: false, category: "network_timeout" };
      }
    },
  };
}

/**
 * Bounded Libre diagnostic sequence for operator verification.
 * Reuses the same login/connections/graph helpers as ingestion — no duplicate HTTP logic.
 */
export async function runLibreDiagnosticFlow(
  creds: LibreCreds | null,
  deps?: { fetch?: FetchLike; existingSession?: LibreSession | null },
): Promise<LibreDiagnosticSummary> {
  const baseSummary: LibreDiagnosticSummary = {
    status: "unknown_provider_error",
    messageKey: diagnosticMessageKey("unknown_provider_error"),
    authenticationSucceeded: false,
    regionResolved: false,
    connectionCount: 0,
    selectedConnectionFound: false,
    graphRequestSucceeded: false,
    readingCount: 0,
    latestReadingTimestamp: null,
    reconnectRequired: true,
    retryable: false,
    multiConnectionDetected: false,
  };

  if (!creds) {
    return {
      ...baseSummary,
      status: "no_credentials",
      messageKey: diagnosticMessageKey("no_credentials"),
      reconnectRequired: true,
      retryable: false,
    };
  }

  const doFetch: FetchLike = deps?.fetch ?? fetch;
  let session = deps?.existingSession ?? null;
  let regionResolved = Boolean(creds.apiBase?.trim());

  if (!session) {
    try {
      const login = await libreAttemptLogin(doFetch, creds);
      if (!login.ok) {
        const status = failureCategoryToDiagnostic(login.category);
        return {
          ...baseSummary,
          status,
          messageKey: diagnosticMessageKey(status),
          regionResolved: login.category !== "no_credentials" ? regionResolved : false,
          reconnectRequired: reconnectRequiredForDiagnostic(status),
          retryable: retryableForDiagnostic(status),
        };
      }
      session = { token: login.token, apiBase: login.apiBase, accountId: login.accountId };
      regionResolved = login.regionResolved;
    } catch {
      const status: ProviderDiagnosticCategory = "provider_unavailable";
      return {
        ...baseSummary,
        status,
        messageKey: diagnosticMessageKey(status),
        reconnectRequired: false,
        retryable: true,
      };
    }
  }

  const authOk: LibreDiagnosticSummary = {
    ...baseSummary,
    authenticationSucceeded: true,
    regionResolved,
    apiHostLabel: apiHostLabel(session.apiBase),
    reconnectRequired: false,
    retryable: true,
  };

  try {
    const conn = await libreFetchConnections(doFetch, session);
    if (!conn.ok) {
      const status: ProviderDiagnosticCategory = conn.sessionExpired
        ? "session_expired"
        : failureCategoryToDiagnostic(conn.category === "none" ? "internal_error" : conn.category);
      return {
        ...authOk,
        status,
        messageKey: diagnosticMessageKey(status),
        reconnectRequired: reconnectRequiredForDiagnostic(status),
        retryable: retryableForDiagnostic(status),
      };
    }

    if (!conn.patientId) {
      const status: ProviderDiagnosticCategory = "no_shared_patient";
      return {
        ...authOk,
        status,
        messageKey: diagnosticMessageKey(status),
        connectionCount: conn.connectionCount,
        selectedConnectionFound: false,
        reconnectRequired: false,
        retryable: true,
      };
    }

    const graph = await libreFetchGraph(doFetch, session, conn.patientId);
    if (!graph.ok) {
      const status: ProviderDiagnosticCategory = graph.sessionExpired
        ? "session_expired"
        : failureCategoryToDiagnostic(graph.category === "none" ? "internal_error" : graph.category);
      return {
        ...authOk,
        status,
        messageKey: diagnosticMessageKey(status),
        connectionCount: conn.connectionCount,
        selectedConnectionFound: true,
        multiConnectionDetected: conn.connectionCount > 1,
        reconnectRequired: reconnectRequiredForDiagnostic(status),
        retryable: retryableForDiagnostic(status),
      };
    }

    const latest = graph.entries.reduce<string | null>((max, e) => {
      if (!max || e.timestamp > max) return e.timestamp;
      return max;
    }, null);

    if (graph.entries.length === 0) {
      const status: ProviderDiagnosticCategory = "connected_no_data";
      return {
        ...authOk,
        status,
        messageKey: diagnosticMessageKey(status),
        connectionCount: conn.connectionCount,
        selectedConnectionFound: true,
        graphRequestSucceeded: true,
        readingCount: 0,
        reconnectRequired: false,
        retryable: true,
        multiConnectionDetected: conn.connectionCount > 1,
      };
    }

    const status: ProviderDiagnosticCategory = "connected";
    return {
      ...authOk,
      status,
      messageKey: diagnosticMessageKey(status),
      connectionCount: conn.connectionCount,
      selectedConnectionFound: true,
      graphRequestSucceeded: true,
      readingCount: graph.entries.length,
      latestReadingTimestamp: latest,
      reconnectRequired: false,
      retryable: false,
      multiConnectionDetected: conn.connectionCount > 1,
    };
  } catch {
    const status: ProviderDiagnosticCategory = "provider_unavailable";
    return {
      ...authOk,
      status,
      messageKey: diagnosticMessageKey(status),
      reconnectRequired: false,
      retryable: true,
    };
  }
}

/** `"M/D/YYYY h:mm:ss AM"` — the shape LibreLinkUp uses for both of its timestamp fields. */
const LIBRE_TS_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

/**
 * LibreLinkUp timestamps are wall-clock strings with NO timezone suffix. `FactoryTimestamp` is UTC;
 * parsed explicitly (never via `new Date(string)`) so the host timezone can never shift readings.
 * Numeric input is tolerated as epoch seconds (the legacy assumed shape). Returns epoch ms or null.
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
  // Defensive: accept an unambiguous ISO string (explicit zone) should Abbott ever switch shapes.
  const parsed = Date.parse(raw);
  return /\d[Tt ]\d.*(Z|[+-]\d{2}:?\d{2})$/.test(raw.trim()) && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Libre `TrendArrow` (1 = falling fast … 3 = stable … 5 = rising fast) → the Dexcom trend scale
 * (1 = DoubleUp … 4 = Flat … 7 = DoubleDown), which is what `dexcomTrend` means everywhere
 * downstream (mobile `utils/trend.ts`, portal `app-dose/trend.ts`, dose trend-adjustment). Storing
 * the raw Libre value would INVERT the arrows — Libre 5 "rising fast" renders as Dexcom 5 "falling
 * slowly". Libre has no double-arrow state, so its extremes map to SingleUp/SingleDown (2/6): still
 * inside the "fast" band that drives trend warnings, without claiming the maximum speed.
 */
const LIBRE_TO_DEXCOM_TREND: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 3, 5: 2 };

export function libreTrendToDexcom(trend: unknown): number | undefined {
  return LIBRE_TO_DEXCOM_TREND[Number(trend)];
}

/**
 * Normalizes one LibreLinkUp glucose item (`graphData[]` row or `connection.glucoseMeasurement`).
 * Mirrors the api-server `/libre/readings` mapping — keep both in sync so the dedupe key
 * (ISO timestamp) stays stable across writers. Returns null (skipped) for rows lacking a usable
 * timestamp/value rather than fabricating a "now" reading.
 */
function normalizeLibreReading(item: Record<string, unknown>): ReadingRecord | null {
  // `Timestamp` (the patient's LOCAL clock) is only trusted when numeric; its string form has no
  // zone and would shift readings by the patient's UTC offset.
  const ms =
    parseLibreUtcTimestamp(item.FactoryTimestamp) ??
    (typeof item.Timestamp === "number" ? parseLibreUtcTimestamp(item.Timestamp) : null);
  // `ValueInMgPerDl` is always mg/dL. `Value` is in the account's DISPLAY unit, so it is a safe
  // fallback only when `GlucoseUnits` says mg/dL (1) — a mmol/L value stored as mg/dL would read
  // ~18× low and spray false low-glucose alerts.
  const mgdl = Number(item.ValueInMgPerDl);
  const displayValue = Number(item.Value);
  const glucose = Number.isFinite(mgdl) && mgdl > 0
    ? mgdl
    : item.GlucoseUnits === 1 && Number.isFinite(displayValue) && displayValue > 0
      ? displayValue
      : NaN;
  if (ms === null || !Number.isFinite(glucose)) return null;
  const entry: ReadingRecord = {
    glucose,
    timestamp: new Date(ms).toISOString(),
    anomaly: anomalyFor(glucose),
  };
  const trend = libreTrendToDexcom(item.TrendArrow);
  if (trend != null) entry.dexcomTrend = trend;
  return entry;
}
