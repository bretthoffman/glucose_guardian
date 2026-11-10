/**
 * The circle's current CGM sensor (convex/sensor) and where it is in its life right now, ticking
 * every 30 seconds. Shared by the badge at the top of the Glucose screen, the Dashboard's Sensor row,
 * the Sensor pop-up and the "New sensor?" prompt.
 */
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { api } from "@/utils/convex-auth-client";
import { sensorStatus, SENSOR_SPECS, type SensorKind } from "../../../convex/sensorLogic";

/** Who is looking: a code session or nurse account by its code, a family account by sign-in. */
export function useSensorArgs(): { code?: string } | null {
  const auth = useAuth();
  return useMemo(() => {
    if (auth.doctorSession) return null;
    if (auth.caregiverSession) return auth.caregiverCodeKind === "access" && auth.caregiverCloudCode ? { code: auth.caregiverCloudCode } : null;
    if (auth.isCaregiverAccount) return auth.nurseViewCode ? { code: auth.nurseViewCode } : null;
    if (!auth.isSignedIn || !auth.account?.convexUserId) return null;
    return {};
  }, [auth.doctorSession, auth.caregiverSession, auth.caregiverCodeKind, auth.caregiverCloudCode, auth.isCaregiverAccount, auth.nurseViewCode, auth.isSignedIn, auth.account?.convexUserId]);
}

export function useSensor() {
  const args = useSensorArgs();
  const data = useQuery(api.sensor.current, args ?? "skip");
  const { history } = useGlucose();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const sensor = data?.sensor && !data.sensor.endedAt ? data.sensor : null;
  const lastReadingMs = useMemo(() => {
    let max = 0;
    for (const h of history) {
      const t = new Date(h.timestamp).getTime();
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max;
  }, [history]);
  const status = sensor ? sensorStatus(sensor.kind as SensorKind, sensor.startedAt, now, lastReadingMs > sensor.startedAt) : null;
  const spec = sensor ? SENSOR_SPECS[sensor.kind as SensorKind] : null;
  return { args, data, sensor, status, spec, now };
}
