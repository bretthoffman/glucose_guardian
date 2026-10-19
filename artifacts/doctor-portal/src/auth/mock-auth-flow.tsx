import { useEffect, useState, type ReactNode } from "react";
import { useDoctorSession } from "./mock-session";
import { inviteFromUrl, type Access } from "./access-code";
import { HomeScreen } from "./screens/home-screen";
import { OrgPicker } from "./screens/org-picker";
import { CreateAccountStep } from "./screens/create-account-step";
import { CredentialsStep, hasSignedInBefore } from "./screens/credentials-step";
import { SetPinStep } from "./screens/set-pin-step";
import { PinLock } from "./screens/pin-lock";

type Screen =
  | { name: "home" }
  | { name: "signin" }
  /** Invite path: an invite doesn't name the organization, so the doctor picks it first. */
  | { name: "org"; access: Access }
  | { name: "create"; access: Access };

/** A browser that has signed in before opens on sign-in; everyone else (and invite links) on home. */
const firstScreen = (): Screen => (hasSignedInBefore() && !inviteFromUrl() ? { name: "signin" } : { name: "home" });

/**
 * Controller for the doctor auth flow. The home screen takes a license key or invite code:
 *
 *   Home ──license key──────────────────────────────► Create account (org filled in) ─► email code
 *     │  └─invite code──► Find your organization ──► Create account
 *     ├─"Try the demo"
 *     └─"Sign in" ◄──► Sign in
 *
 * After authentication: the PIN (set once, then unlock), then the authorized app (`children`).
 */
export function MockAuthFlow({ children }: { children: ReactNode }) {
  const { step } = useDoctorSession();
  const [screen, setScreen] = useState<Screen>(firstScreen);

  // Leaving the authenticate step (successful sign-in/up, or sign-out later) resets the sub-flow.
  useEffect(() => {
    if (step !== "authenticate") setScreen(firstScreen());
  }, [step]);

  const home = () => setScreen({ name: "home" });
  const signIn = () => setScreen({ name: "signin" });

  switch (step) {
    case "authenticate":
      switch (screen.name) {
        case "signin":
          return <CredentialsStep onBack={home} />;
        case "org":
          return (
            <OrgPicker
              onPicked={() => setScreen({ name: "create", access: screen.access })}
              onBack={home}
            />
          );
        case "create":
          return (
            <CreateAccountStep
              access={screen.access}
              onBack={home}
              onSignIn={signIn}
              onChangeOrg={() => setScreen({ name: "org", access: screen.access })}
            />
          );
        default:
          return (
            <HomeScreen
              onSignIn={signIn}
              onAccess={(access) =>
                setScreen(access.kind === "license" ? { name: "create", access } : { name: "org", access })
              }
            />
          );
      }
    case "set_pin":
      return <SetPinStep />;
    case "locked":
      return <PinLock />;
    case "ready":
      return <>{children}</>;
  }
}
