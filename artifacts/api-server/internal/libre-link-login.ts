export const LIBRE_DEFAULT_BASE = "https://api.libreview.io";

const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  Connection: "Keep-Alive",
  product: "llu.android",
  version: "4.7.0",
} as const;

export type LibreLinkLoginResult =
  | { ok: true; token: string; accountId?: string; apiBase: string }
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

  return { ok: true, token, accountId, apiBase };
}

export { LIBRE_HEADERS };
