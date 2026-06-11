import { Router, type IRouter } from "express";
import { api } from "../../../../convex/_generated/api.js";
import {
  createConvexPatientBackendClient,
  getConvexPatientBackendSecret,
  isConvexPatientBackendConfigured,
} from "../convex-patient-backend.js";
import { dexcomShareLogin } from "../dexcom-share-login.js";
import {
  LIBRE_DEFAULT_BASE,
  LIBRE_HEADERS,
  libreLinkLogin,
} from "../libre-link-login.js";

const router: IRouter = Router();

const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";

const DEXCOM_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/978.0.7 Darwin/18.7.0",
} as const;

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
    const result = await libreLinkLogin({ email: String(email ?? ""), password: String(password ?? "") });
    if (!result.ok) {
      res.status(result.httpStatus).json({ error: result.error });
      return;
    }
    res.json({
      token: result.token,
      accountId: result.accountId,
      apiBase: result.apiBase,
    });
  } catch (err) {
    console.error("Libre connect error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not connect to LibreLink Up. Please try again." });
  }
});

router.post("/libre/credentials", async (req, res) => {
  try {
    if (!isConvexPatientBackendConfigured()) {
      res.status(503).json({ error: "Libre credential storage is not configured on this server." });
      return;
    }
    const { userId, passwordHash, email, password, apiBase } = req.body ?? {};
    if (!userId || !passwordHash || !email || !password) {
      res.status(400).json({ error: "userId, passwordHash, email, and password are required" });
      return;
    }
    const client = createConvexPatientBackendClient();
    const secret = getConvexPatientBackendSecret();
    try {
      await client.mutation(api.patientLibreSecrets.upsertCredentials, {
        serverSecret: secret,
        userId,
        passwordHash,
        libreEmail: String(email).trim(),
        librePassword: String(password),
        libreApiBase: apiBase ? String(apiBase).trim() : undefined,
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
    console.error("Libre credentials store error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not store Libre credentials." });
  }
});

router.post("/libre/refresh-session", async (req, res) => {
  try {
    if (!isConvexPatientBackendConfigured()) {
      res.status(503).json({ error: "Libre credential storage is not configured on this server." });
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
      libreEmail: string;
      librePassword: string;
      libreApiBase?: string;
    } | null;
    try {
      creds = await client.mutation(api.patientLibreSecrets.getCredentialsForServer, {
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
      res.status(401).json({ error: "No stored Libre credentials or unauthorized." });
      return;
    }
    const login = await libreLinkLogin({
      email: creds.libreEmail,
      password: creds.librePassword,
      apiBase: creds.libreApiBase,
    });
    if (!login.ok) {
      res.status(login.httpStatus).json({ error: login.error });
      return;
    }
    res.json({
      token: login.token,
      accountId: login.accountId,
      apiBase: login.apiBase,
    });
  } catch (err) {
    console.error("Libre refresh-session error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not refresh Libre session." });
  }
});

router.post("/libre/clear-credentials", async (req, res) => {
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
      await client.mutation(api.patientLibreSecrets.clearCredentials, {
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
    console.error("Libre clear-credentials error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not clear stored Libre credentials." });
  }
});

router.post("/libre/readings", async (req, res) => {
  try {
    const { token, apiBase } = req.body ?? {};
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }

    const base = (typeof apiBase === "string" && apiBase.trim()
      ? apiBase.trim()
      : LIBRE_DEFAULT_BASE
    ).replace(/\/$/, "");

    const connectionsResp = await fetch(`${base}/llu/connections`, {
      headers: { ...LIBRE_HEADERS, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!connectionsResp.ok) {
      console.log("Libre readings: connections non-OK status", connectionsResp.status);
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
    const graphResp = await fetch(`${base}/llu/connections/${patientId}/graph`, {
      headers: { ...LIBRE_HEADERS, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!graphResp.ok) {
      console.log("Libre readings: graph non-OK status", graphResp.status);
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
    console.error("Libre readings error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Could not fetch LibreLink readings." });
  }
});

export default router;
