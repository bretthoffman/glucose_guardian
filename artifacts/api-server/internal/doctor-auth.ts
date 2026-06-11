import { createHash, randomBytes } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
  createConvexDoctorAccountsClient,
  getConvexDoctorApiSecret,
  isConvexDoctorAccountsConfigured,
  normalizeDoctorAccessCode,
} from "./convex-doctor-accounts.js";

export type DoctorAuthedRequest = Request & {
  doctorId: string;
  doctorAccessCode?: string;
};

export function hashDoctorSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createDoctorSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function resolveDoctorIdFromRequest(
  req: Request,
): Promise<string | null> {
  if (!isConvexDoctorAccountsConfigured()) return null;
  const token = parseBearerToken(req);
  if (!token) return null;

  const client = createConvexDoctorAccountsClient();
  const result = (await client.query(api.doctorAccounts.validateSession, {
    serverSecret: getConvexDoctorApiSecret(),
    tokenHash: hashDoctorSessionToken(token),
  })) as { doctorId: string } | null;

  return result?.doctorId ?? null;
}

export function requireDoctorAccountsConfigured(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isConvexDoctorAccountsConfigured()) {
    res.status(503).json({
      error:
        "Doctor accounts require CONVEX_URL and CONVEX_DOCTOR_API_SECRET to be configured",
    });
    return;
  }
  next();
}

export function requireDoctorAuth(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    try {
      if (!isConvexDoctorAccountsConfigured()) {
        res.status(503).json({
          error:
            "Doctor accounts require CONVEX_URL and CONVEX_DOCTOR_API_SECRET to be configured",
        });
        return;
      }
      const doctorId = await resolveDoctorIdFromRequest(req);
      if (!doctorId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      (req as DoctorAuthedRequest).doctorId = doctorId;
      next();
    } catch (e) {
      console.error("[doctor-auth] requireDoctorAuth", e);
      res.status(500).json({ error: "Doctor auth error" });
    }
  })();
}

export function requireDoctorPatientLink(paramName = "accessCode") {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const authed = req as DoctorAuthedRequest;
        const doctorId = authed.doctorId ?? (await resolveDoctorIdFromRequest(req));
        if (!doctorId) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        authed.doctorId = doctorId;

        const raw = req.params[paramName];
        const paramValue = Array.isArray(raw) ? raw[0] : raw;
        if (!paramValue) {
          res.status(400).json({ error: "accessCode required" });
          return;
        }

        const client = createConvexDoctorAccountsClient();
        const check = (await client.query(api.doctorAccounts.assertCanAccess, {
          serverSecret: getConvexDoctorApiSecret(),
          doctorId: doctorId as Id<"doctorAccounts">,
          accessCode: paramValue,
        })) as { allowed: boolean; accessCode: string };

        if (!check.allowed) {
          res.status(403).json({ error: "No access to this patient" });
          return;
        }

        authed.doctorAccessCode = check.accessCode;
        next();
      } catch (e) {
        console.error("[doctor-auth] requireDoctorPatientLink", e);
        res.status(500).json({ error: "Doctor auth error" });
      }
    })();
  };
}

export { normalizeDoctorAccessCode };
