const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";

const DEXCOM_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/978.0.7 Darwin/18.7.0",
} as const;

const DEXCOM_APP_ID = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

export type DexcomShareLoginResult =
  | { ok: true; sessionId: string; outsideUS: boolean }
  | { ok: false; httpStatus: number; error: string };

/**
 * Authenticate against Dexcom Share and obtain a publisher session id.
 * Same behavior as the legacy `/dexcom/connect` route (messages preserved).
 */
export async function dexcomShareLogin(input: {
  username: string;
  password: string;
  outsideUS: boolean;
}): Promise<DexcomShareLoginResult> {
  const { username, password, outsideUS } = input;
  if (!username || !password) {
    return { ok: false, httpStatus: 400, error: "Username and password required" };
  }

  const base = outsideUS ? DEXCOM_BASE_OUS : DEXCOM_BASE;

  const authResp = await fetch(`${base}/General/AuthenticatePublisherAccount`, {
    method: "POST",
    headers: DEXCOM_HEADERS,
    body: JSON.stringify({
      accountName: username,
      password,
      applicationId: DEXCOM_APP_ID,
    }),
  });

  const authText = await authResp.text();

  if (!authResp.ok) {
    let msg = "Could not sign in to Dexcom. Check your Dexcom username and password.";
    try {
      const parsed = JSON.parse(authText) as { Code?: string; Message?: string };
      const code = parsed?.Code ?? "";
      if (code === "AccountPasswordInvalid") {
        msg = "Incorrect password. Check the password for your Dexcom account.";
      } else if (code === "AccountNotFound") {
        msg =
          "No Dexcom account found with that username. Open the Dexcom app → Settings → Account to confirm your Dexcom username.";
      } else if (code === "AccountLockout") {
        msg = "Your Dexcom account is temporarily locked due to too many failed attempts. Try again in a few minutes.";
      } else if (parsed?.Message) {
        msg = parsed.Message;
      } else if (typeof parsed === "string" && (parsed as string).length < 200) {
        msg = parsed as string;
      }
    } catch {
      /* keep default */
    }
    return { ok: false, httpStatus: 401, error: msg };
  }

  let accountId: string;
  try {
    accountId = JSON.parse(authText) as string;
  } catch {
    accountId = authText.replace(/^"|"$/g, "").trim();
  }

  if (!accountId || typeof accountId !== "string" || accountId.length < 10) {
    return {
      ok: false,
      httpStatus: 401,
      error: "Could not get Dexcom account ID. Check your credentials.",
    };
  }

  const loginResp = await fetch(`${base}/General/LoginPublisherAccountById`, {
    method: "POST",
    headers: DEXCOM_HEADERS,
    body: JSON.stringify({
      accountId,
      password,
      applicationId: DEXCOM_APP_ID,
    }),
  });

  const loginText = await loginResp.text();

  if (!loginResp.ok) {
    let msg = "Dexcom login failed. Please try again.";
    try {
      const parsed = JSON.parse(loginText) as { Message?: string };
      if (parsed?.Message) msg = parsed.Message;
    } catch {
      /* keep default */
    }
    return { ok: false, httpStatus: 401, error: msg };
  }

  let sessionId: string;
  try {
    sessionId = JSON.parse(loginText) as string;
  } catch {
    sessionId = loginText.replace(/^"|"$/g, "").trim();
  }

  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 10) {
    return {
      ok: false,
      httpStatus: 401,
      error: "Invalid Dexcom session returned. Please try again.",
    };
  }

  return { ok: true, sessionId, outsideUS };
}
