import type { ReactNode } from "react";
import { MockAuthFlow } from "./mock-auth-flow";

/**
 * Route guard. The doctor sign-in flow (organization → account sign-in → optional PIN lock)
 * renders until a session is ready, then the authorized app (`children`).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  return <MockAuthFlow>{children}</MockAuthFlow>;
}
