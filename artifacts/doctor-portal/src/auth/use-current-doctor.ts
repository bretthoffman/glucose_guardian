import { useContext } from "react";
import { MockSessionContext } from "./mock-session";

export interface DoctorProfile {
  id: string;
  displayName: string;
  email: string;
  role: "doctor" | "org_admin";
  title?: string;
  specialty?: string;
  photoDataUri?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Authorization state for the signed-in doctor. Resolved from the active session, which holds
 * the real DoctorProfile returned by the backend's /api/doctor/auth/login. No session → not
 * provisioned (the auth flow takes over).
 */
export type DoctorAccessState =
  | { status: "loading" }
  | { status: "not_provisioned" }
  | { status: "pending" }
  | { status: "suspended" }
  | { status: "active"; doctor: DoctorProfile; organization: Organization };

export function useCurrentDoctor(): DoctorAccessState {
  const session = useContext(MockSessionContext);
  const d = session?.doctor;
  if (d) {
    return {
      status: "active",
      doctor: {
        id: d.doctorId,
        displayName: d.displayName,
        email: d.email,
        role: "doctor",
        title: d.title,
        specialty: d.specialty,
        photoDataUri: d.photoDataUri,
      },
      organization: session?.org ?? { id: "", name: d.institution ?? "—", slug: "" },
    };
  }
  return { status: "not_provisioned" };
}
