import { useContext } from "react";
import { MockSessionContext } from "./mock-session";

/**
 * App-shell session controls (sign out, lock) backed by the doctor session.
 */
export function useSession(): {
  signOut: () => void;
  lock: () => void;
  canLock: boolean;
} {
  const session = useContext(MockSessionContext);
  if (session) {
    return {
      signOut: session.actions.signOut,
      lock: session.actions.lock,
      canLock: session.canLock,
    };
  }
  return { signOut: () => {}, lock: () => {}, canLock: false };
}
