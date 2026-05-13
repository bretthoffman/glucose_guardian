import { Router, type IRouter } from "express";
import { api } from "../../../../convex/_generated/api.js";
import {
  createConvexPatientBackendClient,
  getConvexPatientBackendSecret,
  isConvexPatientBackendConfigured,
} from "../convex-patient-backend.js";
import { dexcomShareLogin } from "../dexcom-share-login.js";

const router: IRouter = Router();

const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";
const LIBRE_BASE = "https://api.libreview.io";

const DEXCOM_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/978.0.7 Darwin/18.7.0",
} as const;

const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  Connection: "Keep-Alive",
  product: "llu.android",
  version: "4.7.0",
};

router.post("/dexcom/connect", async (req, res) => {
  try {
    const { username, password, outsideUS = false } = req.body ?? {};
    const result = await dexcomShareLogin({
      username,
      password,
      outsideUS: Boolean(outsideUS),
    });
    if (!result.ok) {
      res.status(result.httpStatus).json({ error: result.error });
      return;
    }
    res.json({ sessionId: result.sessionId, outsideUS: result.outsideUS });
  } catch (err) {
    console.error("Dexcom connect error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not reach Dexcom servers. Check your internet connection." });
  }
});

router.post("/dexcom/credentials", async (req, res) => {
  try {
    if (!isConvexPatientBackendConfigured()) {
      res.status(503).json({ error: "Dexcom credential storage is not configured on this server." });
      return;
    }
    const { userId, passwordHash, username, password, outsideUS = false } = req.body ?? {};
    if (!userId || !passwordHash || !username || !password) {
      res.status(400).json({ error: "userId, passwordHash, username, and password are required" });
      return;
    }
    const client = createConvexPatientBackendClient();
    const secret = getConvexPatientBackendSecret();
    try {
      await client.mutation(api.patientDexcomSecrets.upsertCredentials, {
        serverSecret: secret,
        userId,
        passwordHash,
        dexcomUsername: String(username).trim(),
        dexcomPassword: String(password),
        outsideUS: Boolean(outsideUS),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "Unauthorized" || msg.includes("Unauthorized patient backend")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Dexcom credentials store error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not store Dexcom credentials." });
  }
});

router.post("/dexcom/refresh-session", async (req, res) => {
  try {
    if (!isConvexPatientBackendConfigured()) {
      res.status(503).json({ error: "Dexcom credential storage is not configured on this server." });
      return;
    }
    const { userId, passwordHash } = req.body ?? {};
    if (!userId || !passwordHash) {
      res.status(400).json({ error: "userId and passwordHash are required" });
      return;
    }
    const client = createConvexPatientBackendClient();
    const secret = getConvexPatientBackendSecret();
    let creds: {
      dexcomUsername: string;
      dexcomPassword: string;
      outsideUS: boolean;
    } | null;
    try {
      creds = await client.mutation(api.patientDexcomSecrets.getCredentialsForServer, {
        serverSecret: secret,
        userId,
        passwordHash,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Unauthorized patient backend")) {
        res.status(503).json({ error: "Server configuration error." });
        return;
      }
      throw e;
    }
    if (!creds) {
      res.status(401).json({ error: "No stored Dexcom credentials or unauthorized." });
      return;
    }
    const login = await dexcomShareLogin({
      username: creds.dexcomUsername,
      password: creds.dexcomPassword,
      outsideUS: creds.outsideUS,
    });
    if (!login.ok) {
      res.status(login.httpStatus).json({ error: login.error });
      return;
    }
    res.json({ sessionId: login.sessionId, outsideUS: login.outsideUS });
  } catch (err) {
    console.error("Dexcom refresh-session error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not refresh Dexcom session." });
  }
});

router.post("/dexcom/clear-credentials", async (req, res) => {
  try {
    if (!isConvexPatientBackendConfigured()) {
      res.json({ ok: true });
      return;
    }
    const { userId, passwordHash } = req.body ?? {};
    if (!userId || !passwordHash) {
      res.status(400).json({ error: "userId and passwordHash are required" });
      return;
    }
    const client = createConvexPatientBackendClient();
    const secret = getConvexPatientBackendSecret();
    try {
      await client.mutation(api.patientDexcomSecrets.clearCredentials, {
        serverSecret: secret,
        userId,
        passwordHash,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "Unauthorized" || msg.includes("Unauthorized patient backend")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Dexcom clear-credentials error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not clear stored Dexcom credentials." });
  }
});

router.post("/dexcom/readings", async (req, res) => {
  try {
    const { sessionId, outsideUS = false, count = 10 } = req.body ?? {};
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    const base = outsideUS ? DEXCOM_BASE_OUS : DEXCOM_BASE;
    const url = `${base}/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${encodeURIComponent(sessionId)}&minutes=1440&maxCount=${count}`;

    const response = await fetch(url, {
      method: "GET",
      headers: DEXCOM_HEADERS,
    });

    const rawText = await response.text();
    if (!response.ok) {
      console.log("Dexcom readings: non-OK status", response.status);
    } else {
      console.log("Dexcom readings: OK", response.status);
    }

    if (!response.ok) {
      let msg = "Session expired. Please reconnect Dexcom.";
      try {
        const parsed = JSON.parse(rawText) as { Message?: string };
        if (parsed?.Message) msg = parsed.Message;
        else if (typeof rawText === "string") {
          if (rawText.includes("SessionNotValid") || rawText.toLowerCase().includes("session")) {
            msg = "Dexcom session expired. Please reconnect.";
          } else if (rawText.length < 200) {
            msg = rawText;
          }
        }
      } catch {
        /* keep default */
      }
      res.status(401).json({ error: msg });
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      res.status(500).json({ error: "Unexpected response from Dexcom. Please try again." });
      return;
    }

    if (!Array.isArray(data)) {
      if (typeof data === "string" && (data.includes("SessionNotValid") || data.includes("session"))) {
        res.status(401).json({ error: "Dexcom session expired. Please reconnect." });
        return;
      }
      res.status(500).json({ error: "Unexpected Dexcom response format." });
      return;
    }

    const readings = data.map((item: Record<string, unknown>) => {
      let timestamp: string;
      try {
        const raw = (item.ST ?? item.WT ?? "") as string;
        const match = String(raw).match(/Date\((\d+)/);
        const ms = match ? parseInt(match[1]!, 10) : NaN;
        timestamp = isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }
      const value = (item.Value ?? item.value ?? 0) as number;
      return {
        glucose: value,
        timestamp,
        trend: item.Trend ?? item.trend ?? 0,
        anomaly: {
          warning: value < 70 || value > 240,
          message:
            value < 70
              ? `Low glucose: ${value} mg/dL`
              : value > 240
                ? `High glucose: ${value} mg/dL`
                : undefined,
        },
      };
    });

    readings.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({ readings });
  } catch (err) {
    console.error("Dexcom readings error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not fetch Dexcom readings. Check your connection and try again." });
  }
});

router.post("/libre/connect", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }

    const loginUrl = `${LIBRE_BASE}/llu/auth/login`;
    const loginBody = JSON.stringify({ email, password });

    let loginResp = await fetch(loginUrl, {
      method: "POST",
      headers: { ...LIBRE_HEADERS, Accept: "application/json" },
      body: loginBody,
    });

    let loginText = await loginResp.text();
    console.log("Libre login response:", loginResp.status, loginText.slice(0, 300));

    let loginData: Record<string, unknown> | null;
    try {
      loginData = JSON.parse(loginText) as Record<string, unknown>;
    } catch {
      loginData = null;
    }

    if (loginData?.status === 2 && (loginData.data as Record<string, unknown> | undefined)?.redirect === true) {
      const region = String((loginData.data as { region?: string })?.region ?? "us");
      const regionalBase = `https://api.${region}.libreview.io`;
      console.log("Libre redirect to region:", region);

      loginResp = await fetch(`${regionalBase}/llu/auth/login`, {
        method: "POST",
        headers: { ...LIBRE_HEADERS, Accept: "application/json" },
        body: loginBody,
      });

      loginText = await loginResp.text();
      console.log("Libre regional login response:", loginResp.status, loginText.slice(0, 300));
      try {
        loginData = JSON.parse(loginText) as Record<string, unknown>;
      } catch {
        loginData = null;
      }
    }

    if (!loginResp.ok) {
      const msg =
        (loginData?.message as string | undefined) ??
        (loginData?.error as string | undefined) ??
        "Invalid LibreLink credentials. Check your email and password.";
      res.status(401).json({ error: msg });
      return;
    }

    const token = (loginData?.data as { authTicket?: { token?: string } } | undefined)?.authTicket?.token;

    if (!token) {
      res.status(401).json({
        error:
          "Could not authenticate with LibreLink Up. Make sure LibreLinkUp Sharing is enabled in your LibreLink app.",
      });
      return;
    }

    const accountId = (loginData?.data as { user?: { id?: string } } | undefined)?.user?.id;

    res.json({ token, accountId });
  } catch (err) {
    console.error("Libre connect error:", err);
    res.status(500).json({ error: "Could not connect to LibreLink Up. Please try again." });
  }
});

router.post("/libre/readings", async (req, res) => {
  try {
    const { token } = req.body ?? {};
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }

    const connectionsResp = await fetch(`${LIBRE_BASE}/llu/connections`, {
      headers: { ...LIBRE_HEADERS, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!connectionsResp.ok) {
      res.status(401).json({ error: "Session expired. Please reconnect LibreLink." });
      return;
    }

    const connections = (await connectionsResp.json()) as { data?: { patientId?: string }[] };
    const patients = connections?.data ?? [];
    if (patients.length === 0) {
      res.json({ readings: [] });
      return;
    }

    const patientId = patients[0]!.patientId;
    const graphResp = await fetch(`${LIBRE_BASE}/llu/connections/${patientId}/graph`, {
      headers: { ...LIBRE_HEADERS, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!graphResp.ok) {
      res.status(500).json({ error: "Could not fetch LibreLink readings." });
      return;
    }

    const graphData = (await graphResp.json()) as { data?: { graphData?: Record<string, unknown>[] } };
    const rawReadings = graphData?.data?.graphData ?? [];

    const readings = rawReadings.map((item) => {
      const glucose = (item.ValueInMgPerDl ?? item.Value) as number;
      return {
        glucose,
        timestamp: new Date((item.Timestamp as number) * 1000).toISOString(),
        trend: item.TrendArrow,
        anomaly: {
          warning: glucose < 70 || glucose > 240,
          message:
            glucose < 70
              ? `Low glucose: ${glucose} mg/dL`
              : glucose > 240
                ? `High glucose: ${glucose} mg/dL`
                : undefined,
        },
      };
    });

    res.json({ readings });
  } catch (err) {
    console.error("Libre readings error:", err);
    res.status(500).json({ error: "Could not fetch LibreLink readings." });
  }
});

export default router;
