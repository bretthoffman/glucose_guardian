import { Router, type IRouter } from "express";

const router: IRouter = Router();

const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";
const LIBRE_BASE = "https://api.libreview.io";

const DEXCOM_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "Dexcom Share/3.0.2.11 CFNetwork/978.0.7 Darwin/18.7.0",
};

const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  "Connection": "Keep-Alive",
  "product": "llu.android",
  "version": "4.7.0",
};

router.post("/dexcom/connect", async (req, res) => {
  try {
    const { username, password, outsideUS = false } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const base = outsideUS ? DEXCOM_BASE_OUS : DEXCOM_BASE;
    const appId = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

    // Step 1: Authenticate to get account ID
    const authResp = await fetch(`${base}/General/AuthenticatePublisherAccount`, {
      method: "POST",
      headers: DEXCOM_HEADERS,
      body: JSON.stringify({ accountName: username, password, applicationId: appId }),
    });

    const authText = await authResp.text();
    console.log("Dexcom auth response:", authResp.status, authText.slice(0, 200));

    if (!authResp.ok) {
      let msg = "Invalid Dexcom credentials. Check your Dexcom Share username and password.";
      try {
        const parsed = JSON.parse(authText);
        if (parsed?.Message) msg = parsed.Message;
        else if (typeof parsed === "string" && parsed.length < 200) msg = parsed;
      } catch {}
      res.status(401).json({ error: msg });
      return;
    }

    let accountId: string;
    try {
      accountId = JSON.parse(authText);
    } catch {
      accountId = authText.replace(/^"|"$/g, "").trim();
    }

    if (!accountId || typeof accountId !== "string" || accountId.length < 10) {
      res.status(401).json({ error: "Could not get Dexcom account ID. Check your credentials." });
      return;
    }

    // Step 2: Login with account ID to get session ID
    const loginResp = await fetch(`${base}/General/LoginPublisherAccountById`, {
      method: "POST",
      headers: DEXCOM_HEADERS,
      body: JSON.stringify({ accountId, password, applicationId: appId }),
    });

    const loginText = await loginResp.text();
    console.log("Dexcom login response:", loginResp.status, loginText.slice(0, 200));

    if (!loginResp.ok) {
      let msg = "Dexcom login failed. Please try again.";
      try {
        const parsed = JSON.parse(loginText);
        if (parsed?.Message) msg = parsed.Message;
      } catch {}
      res.status(401).json({ error: msg });
      return;
    }

    let sessionId: string;
    try {
      sessionId = JSON.parse(loginText);
    } catch {
      sessionId = loginText.replace(/^"|"$/g, "").trim();
    }

    if (!sessionId || typeof sessionId !== "string" || sessionId.length < 10) {
      res.status(401).json({ error: "Invalid Dexcom session returned. Please try again." });
      return;
    }

    res.json({ sessionId, outsideUS });
  } catch (err) {
    console.error("Dexcom connect error:", err);
    res.status(500).json({ error: "Could not reach Dexcom servers. Check your internet connection." });
  }
});

router.post("/dexcom/readings", async (req, res) => {
  try {
    const { sessionId, outsideUS = false, count = 10 } = req.body;
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
    console.log("Dexcom readings response:", response.status, rawText.slice(0, 300));

    if (!response.ok) {
      let msg = "Session expired. Please reconnect Dexcom.";
      try {
        const parsed = JSON.parse(rawText);
        if (parsed?.Message) msg = parsed.Message;
        else if (typeof parsed === "string") {
          if (parsed.includes("SessionNotValid") || parsed.includes("session")) {
            msg = "Dexcom session expired. Please reconnect.";
          } else {
            msg = parsed;
          }
        }
      } catch {}
      res.status(401).json({ error: msg });
      return;
    }

    let data: any[];
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

    const readings = data.map((item) => {
      let timestamp: string;
      try {
        const raw = item.ST ?? item.WT ?? "";
        const match = raw.match(/Date\((\d+)/);
        const ms = match ? parseInt(match[1]) : NaN;
        timestamp = isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }
      return {
        glucose: item.Value ?? item.value ?? 0,
        timestamp,
        trend: item.Trend ?? item.trend ?? 0,
        anomaly: {
          warning: (item.Value ?? 0) < 70 || (item.Value ?? 0) > 240,
          message:
            (item.Value ?? 0) < 70
              ? `Low glucose: ${item.Value} mg/dL`
              : (item.Value ?? 0) > 240
              ? `High glucose: ${item.Value} mg/dL`
              : undefined,
        },
      };
    });

    readings.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({ readings });
  } catch (err) {
    console.error("Dexcom readings error:", err);
    res.status(500).json({ error: "Could not fetch Dexcom readings. Check your connection and try again." });
  }
});

router.post("/libre/connect", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }

    const response = await fetch(`${LIBRE_BASE}/llu/auth/login`, {
      method: "POST",
      headers: { ...LIBRE_HEADERS, "Accept": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      res.status(401).json({ error: "Invalid LibreLink credentials." });
      return;
    }

    const data: any = await response.json();
    const token = data?.data?.authTicket?.token;
    const accountId = data?.data?.user?.id;

    if (!token) {
      res.status(401).json({ error: "Could not authenticate with LibreLink Up." });
      return;
    }

    res.json({ token, accountId });
  } catch (err) {
    console.error("Libre connect error:", err);
    res.status(500).json({ error: "Could not connect to LibreLink Up. Please try again." });
  }
});

router.post("/libre/readings", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }

    const connectionsResp = await fetch(`${LIBRE_BASE}/llu/connections`, {
      headers: { ...LIBRE_HEADERS, "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });

    if (!connectionsResp.ok) {
      res.status(401).json({ error: "Session expired. Please reconnect LibreLink." });
      return;
    }

    const connections: any = await connectionsResp.json();
    const patients = connections?.data ?? [];
    if (patients.length === 0) {
      res.json({ readings: [] });
      return;
    }

    const patientId = patients[0].patientId;
    const graphResp = await fetch(`${LIBRE_BASE}/llu/connections/${patientId}/graph`, {
      headers: { ...LIBRE_HEADERS, "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });

    if (!graphResp.ok) {
      res.status(500).json({ error: "Could not fetch LibreLink readings." });
      return;
    }

    const graphData: any = await graphResp.json();
    const rawReadings = graphData?.data?.graphData ?? [];

    const readings = rawReadings.map((item: any) => {
      const glucose = item.ValueInMgPerDl ?? item.Value;
      return {
        glucose,
        timestamp: new Date(item.Timestamp * 1000).toISOString(),
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
