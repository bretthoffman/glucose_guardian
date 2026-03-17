import { Router, type IRouter } from "express";

const router: IRouter = Router();

const DEXCOM_BASE = "https://share1.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services";
const LIBRE_BASE = "https://api.libreview.io";

const LIBRE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "Cache-Control": "no-cache",
  Connection: "Keep-Alive",
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
    const response = await fetch(
      `${base}/General/LoginPublisherAccountByName`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          accountName: username,
          password,
          applicationId: "d8665ade-9673-4e27-9ff6-92db4ce13d13",
        }),
      }
    );

    if (!response.ok) {
      res.status(401).json({ error: "Invalid Dexcom credentials. Check your username and password." });
      return;
    }

    const sessionId = await response.json();
    if (!sessionId || typeof sessionId !== "string") {
      res.status(401).json({ error: "Invalid Dexcom credentials." });
      return;
    }

    res.json({ sessionId, outsideUS });
  } catch (err) {
    console.error("Dexcom connect error:", err);
    res.status(500).json({ error: "Could not connect to Dexcom. Please try again." });
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
    const url = `${base}/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${sessionId}&minutes=1440&maxCount=${count}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      res.status(401).json({ error: "Session expired. Please reconnect Dexcom." });
      return;
    }

    const data: any[] = await response.json();
    const readings = data.map((item) => ({
      glucose: item.Value,
      timestamp: new Date(parseInt(item.ST.replace(/\/Date\((\d+)\)\//, "$1"))).toISOString(),
      trend: item.Trend,
      anomaly: {
        warning: item.Value < 70 || item.Value > 240,
        message:
          item.Value < 70
            ? `Low glucose: ${item.Value} mg/dL`
            : item.Value > 240
            ? `High glucose: ${item.Value} mg/dL`
            : undefined,
      },
    }));

    res.json({ readings });
  } catch (err) {
    console.error("Dexcom readings error:", err);
    res.status(500).json({ error: "Could not fetch Dexcom readings." });
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

    const readings = rawReadings.slice(-10).map((item: any) => {
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
