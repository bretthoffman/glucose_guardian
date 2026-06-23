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
import { PROVIDER_LIMITS } from "./config";

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
}

export const LIBRE_DEFAULT_BASE = "https://api.libreview.io";
const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  Connection: "Keep-Alive",
  product: "llu.android",
  version: "4.7.0",
} as const;

export function makeLibreAdapter(deps?: { fetch?: FetchLike }): ProviderAdapter<LibreCreds, LibreSession> {
  const doFetch: FetchLike = deps?.fetch ?? fetch;

  return {
    provider: "libre",
    limits: PROVIDER_LIMITS.libre,

    async login(creds: LibreCreds): Promise<LoginOutcome<LibreSession>> {
      if (!creds.email || !creds.password) return { ok: false, category: "no_credentials" };
      let base = (creds.apiBase?.trim() || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
      const body = JSON.stringify({ email: creds.email.trim(), password: creds.password });

      const attempt = async (b: string) => {
        const resp = await doFetch(`${b}/llu/auth/login`, {
          method: "POST",
          headers: { ...LIBRE_HEADERS, Accept: "application/json" },
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

      try {
        let { resp, data } = await attempt(base);
        // Region redirect: global host points to the regional host owning this account.
        if (data?.status === 2 && (data.data as Record<string, unknown> | undefined)?.redirect === true) {
          const region = String((data.data as { region?: string })?.region ?? "us");
          base = `https://api.${region}.libreview.io`;
          ({ resp, data } = await attempt(base));
        }
        if (!resp.ok) {
          return { ok: false, category: resp.status === 401 ? "invalid_credentials" : httpTransientCategory(resp.status) };
        }
        const token = (data?.data as { authTicket?: { token?: string } } | undefined)?.authTicket?.token;
        if (!token) {
          // Authenticated but no share token usually means LibreLinkUp Sharing is off → user action.
          return { ok: false, category: "invalid_credentials" };
        }
        return { ok: true, session: { token, apiBase: base } };
      } catch {
        return { ok: false, category: "network_timeout" };
      }
    },

    // Libre `/graph` returns a fixed recent window; `plan` count/window are ignored by design.
    async read(session: LibreSession): Promise<ReadOutcome> {
      const base = (session.apiBase || LIBRE_DEFAULT_BASE).replace(/\/$/, "");
      const authHeaders = { ...LIBRE_HEADERS, Authorization: `Bearer ${session.token}`, Accept: "application/json" };
      try {
        const connResp = await doFetch(`${base}/llu/connections`, { headers: authHeaders });
        if (!connResp.ok) {
          return {
            ok: false,
            sessionExpired: connResp.status === 401,
            category: connResp.status === 401 ? "none" : httpTransientCategory(connResp.status),
          };
        }
        const connections = (await connResp.json()) as { data?: { patientId?: string }[] };
        const patientId = connections?.data?.[0]?.patientId;
        if (!patientId) return { ok: true, entries: [] };

        const graphResp = await doFetch(`${base}/llu/connections/${patientId}/graph`, { headers: authHeaders });
        if (!graphResp.ok) {
          return {
            ok: false,
            sessionExpired: graphResp.status === 401,
            category: graphResp.status === 401 ? "none" : httpTransientCategory(graphResp.status),
          };
        }
        const graphData = (await graphResp.json()) as { data?: { graphData?: Record<string, unknown>[] } };
        const raw = graphData?.data?.graphData ?? [];
        const entries: ReadingRecord[] = [];
        for (const item of raw) {
          const entry = normalizeLibreReading(item);
          if (entry) entries.push(entry);
        }
        return { ok: true, entries };
      } catch {
        return { ok: false, sessionExpired: false, category: "network_timeout" };
      }
    },
  };
}

/**
 * Mirrors the api-server `/libre/readings` mapping. Returns null (skipped) for rows lacking a usable
 * numeric timestamp/value rather than fabricating a "now" reading — so we never insert a row the
 * client path would not have produced, keeping the dedupe key stable across both writers.
 */
function normalizeLibreReading(item: Record<string, unknown>): ReadingRecord | null {
  const ms = Number(item.Timestamp) * 1000;
  const glucose = Number(item.ValueInMgPerDl ?? item.Value);
  if (!Number.isFinite(ms) || !Number.isFinite(glucose)) return null;
  const entry: ReadingRecord = {
    glucose,
    timestamp: new Date(ms).toISOString(),
    anomaly: anomalyFor(glucose),
  };
  const trend = item.TrendArrow;
  if (trend != null) entry.dexcomTrend = trend as number | string;
  return entry;
}
