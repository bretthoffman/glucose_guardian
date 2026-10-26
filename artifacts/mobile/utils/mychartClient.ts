/**
 * MyChart (Epic) sign-in and lab download, SMART on FHIR standalone launch with PKCE.
 *
 * The family signs in on MyChart's own page in the system browser; we never see the password. The
 * access token is used once, on this device, to read lab Observations, and is not stored. Each pull
 * signs in again (MyChart usually remembers the browser session, so it's one tap).
 *
 * Off until Glucose Guardian is registered with Epic: set EXPO_PUBLIC_EPIC_CLIENT_ID (the client id
 * from fhir.epic.com) and, for real health systems, EXPO_PUBLIC_EPIC_ENDPOINTS_URL (the directory of
 * Epic FHIR endpoints). Without a client id the MyChart button doesn't show.
 */
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { labsFromBundle, nextPageUrl } from "@/utils/fhirLabs";
import type { LabResult } from "@/utils/labs";

WebBrowser.maybeCompleteAuthSession();

export const EPIC_CLIENT_ID = process.env.EXPO_PUBLIC_EPIC_CLIENT_ID ?? "";
const ENDPOINTS_URL = process.env.EXPO_PUBLIC_EPIC_ENDPOINTS_URL ?? "";

/** Epic's public test system (works with a non-production client id). */
export const EPIC_SANDBOX: MyChartOrg = {
  name: "Epic test system (sandbox)",
  fhirBase: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
};

export interface MyChartOrg {
  name: string;
  fhirBase: string;
}

export function myChartAvailable(): boolean {
  return EPIC_CLIENT_ID.length > 0;
}

const LAST_ORG_KEY = "@glucose_guardian_mychart_org";

export async function lastMyChartOrg(): Promise<MyChartOrg | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ORG_KEY);
    return raw ? (JSON.parse(raw) as MyChartOrg) : null;
  } catch {
    return null;
  }
}

/** Health systems to pick from: Epic's endpoint directory when configured, else the sandbox. */
export async function listMyChartOrgs(): Promise<MyChartOrg[]> {
  if (!ENDPOINTS_URL) return [EPIC_SANDBOX];
  try {
    const res = await fetch(ENDPOINTS_URL, { headers: { Accept: "application/json" } });
    const body = (await res.json()) as { entry?: { resource?: { name?: string; address?: string } }[] };
    const orgs = (body.entry ?? [])
      .map((e) => ({ name: e.resource?.name ?? "", fhirBase: (e.resource?.address ?? "").replace(/\/$/, "") }))
      .filter((o) => o.name && o.fhirBase.startsWith("https://"));
    return orgs.length > 0 ? orgs.sort((a, b) => a.name.localeCompare(b.name)) : [EPIC_SANDBOX];
  } catch {
    return [EPIC_SANDBOX];
  }
}

interface SmartConfig {
  authorization_endpoint: string;
  token_endpoint: string;
}

async function smartConfig(fhirBase: string): Promise<SmartConfig> {
  const res = await fetch(`${fhirBase}/.well-known/smart-configuration`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("This health system didn't answer. Try again later.");
  const cfg = (await res.json()) as Partial<SmartConfig>;
  if (!cfg.authorization_endpoint || !cfg.token_endpoint) throw new Error("This health system isn't set up for apps yet.");
  return cfg as SmartConfig;
}

export type MyChartPull =
  | { ok: true; labs: Omit<LabResult, "id">[] }
  | { ok: false; cancelled?: boolean; error: string };

/**
 * Sign in to MyChart at `org`, then read lab results (all pages, capped). Returns what was read;
 * the caller saves them (the backend skips ones already saved).
 */
export async function pullMyChartLabs(org: MyChartOrg): Promise<MyChartPull> {
  if (!myChartAvailable()) return { ok: false, error: "MyChart isn't available yet." };
  try {
    const cfg = await smartConfig(org.fhirBase);
    const redirectUri = AuthSession.makeRedirectUri({ scheme: "mobile", path: "mychart" });
    const request = new AuthSession.AuthRequest({
      clientId: EPIC_CLIENT_ID,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      scopes: ["openid", "fhirUser", "launch/patient", "patient/Observation.read", "patient/Patient.read"],
      extraParams: { aud: org.fhirBase },
    });
    const result = await request.promptAsync({ authorizationEndpoint: cfg.authorization_endpoint });
    if (result.type !== "success" || !result.params.code) {
      return { ok: false, cancelled: true, error: "Sign-in was cancelled." };
    }
    const tokenRes = await fetch(cfg.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: result.params.code,
        redirect_uri: redirectUri,
        client_id: EPIC_CLIENT_ID,
        code_verifier: request.codeVerifier ?? "",
      }).toString(),
    });
    const token = (await tokenRes.json()) as { access_token?: string; patient?: string };
    if (!tokenRes.ok || !token.access_token || !token.patient) {
      return { ok: false, error: "MyChart didn't share a chart. Make sure you picked the right person." };
    }
    try {
      await AsyncStorage.setItem(LAST_ORG_KEY, JSON.stringify(org));
    } catch {
      /* remembering the health system is a convenience */
    }
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/fhir+json" };
    let url: string | null =
      `${org.fhirBase}/Observation?patient=${encodeURIComponent(token.patient)}&category=laboratory&_count=100`;
    const labs: Omit<LabResult, "id">[] = [];
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await fetch(url, { headers });
      if (!res.ok) break;
      const bundle = await res.json();
      labs.push(...labsFromBundle(bundle));
      url = nextPageUrl(bundle);
    }
    return { ok: true, labs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach MyChart." };
  }
}
