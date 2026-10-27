export const LIBRE_DEFAULT_BASE = "https://api.libreview.io";

const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  Connection: "Keep-Alive",
  // LibreLinkUp rejects older app versions (status 920) and, since Oct 2025, needs 4.16+ plus the
  // Account-Id header on connections/graph calls (see libreAccountIdHash).
  product: "llu.android",
  version: "4.16.0",
} as const;

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
      headers: { ...LIBRE_HEADERS, Accept: "application/json" },
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

  if (loginData?.status === 2 && (loginData.data as Record<string, unknown> | undefined)?.redirect === true) {
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
        ...LIBRE_HEADERS,
        Authorization: `Bearer ${login.token}`,
        Accept: "application/json",
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

export { LIBRE_HEADERS };
