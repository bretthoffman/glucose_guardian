# Dexcom Username UX Change 01

A tester's Dexcom readings were failing because they entered their email address instead of their Dexcom Share username. When they used the username, readings came through. This change updates the mobile CGM setup screen so Dexcom login consistently uses **username** terminology and rejects email-shaped input. Libre is unchanged and still uses email.

## What changed

- Dexcom field label, placeholder, and keyboard type now reflect username (not email).
- Dexcom requirement copy in the "Before you connect" box now explicitly tells the user to use their Dexcom username, not their email, and points to where to find it in the Dexcom app.
- The "Missing Info" alert now uses the right credential noun for the selected provider (`username` for Dexcom, `email` for Libre).
- A new client-side validation rejects Dexcom submissions whose username contains `@` and shows a clear "Use Your Dexcom Username" alert with a brief how-to-find-it pointer.
- The lock-icon info-box for Dexcom now says it uses "Dexcom Share username and password (not your email)".

## Exact files changed

- `artifacts/mobile/app/cgm-setup.tsx` (only file modified)
- New repo-root markdown: `DEXCOM_USERNAME_UX_CHANGE_01.md`

No other files were touched. Backend (`artifacts/api-server/internal/routes/cgm.ts`), Convex code, auth, and the home screen are unchanged.

## Dexcom wording updates

| Location                           | Before                                                                              | After                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Requirements bullet #2             | "Use the email address you log into the Dexcom app with"                            | "Use your Dexcom username — not your email. Find it in the Dexcom app under Settings → Account."                            |
| Field label                        | "Dexcom Account Email"                                                              | "Dexcom Username"                                                                                                           |
| Placeholder                        | `your@email.com`                                                                    | `yourdexcomusername`                                                                                                        |
| Keyboard type                      | `email-address`                                                                     | `default` (Libre still uses `email-address`)                                                                                |
| Info-box (lock icon) text          | "Uses your Dexcom Share credentials. Readings sync through Dexcom's servers."       | "Uses your Dexcom Share username and password (not your email). Readings sync through Dexcom's servers."                    |
| "Missing Info" alert (Dexcom)      | "Please enter both username/email and password."                                    | "Please enter both username and password."                                                                                  |
| "Missing Info" alert (Libre)       | "Please enter both username/email and password."                                    | "Please enter both email and password."                                                                                     |

Libre wording (label, placeholder, keyboard) is unchanged.

## New validation

In `connect()`, after the empty-field check:

```ts
if (selectedType === "dexcom" && username.includes("@")) {
  Alert.alert(
    "Use Your Dexcom Username",
    "Dexcom Share requires your Dexcom username, not the email address you sign in to the Dexcom app with. Open the Dexcom app → Settings → Account to find your username.",
  );
  return;
}
```

- Triggers only when `selectedType === "dexcom"`.
- Uses the simple, conservative `@` heuristic. Anything containing `@` is treated as an email and blocked. This matches how Dexcom usernames are formatted (no `@` allowed).
- Submission is aborted before any network call. No state change other than showing the alert.

## What was intentionally left unchanged

- Libre flow: label, placeholder, keyboard, validation, and copy are untouched. Libre still requires an email.
- Backend `cgm.ts`: route, request shape, and field name (`username`) are unchanged.
- Dexcom request payload: still posts `{ username: username.trim(), password, outsideUS }` to `/api/cgm/dexcom/connect`.
- `Outside US` toggle, password field, eye toggle, disconnect flow, haptics, navigation.
- Existing connect/disconnect/error handling paths.
- The home-screen sync result UI added in the previous change.

## Manual verification checklist

Dexcom path:

- [ ] Open `cgm-setup`, select **Dexcom**.
- [ ] Confirm the field label reads **Dexcom Username** (not "Dexcom Account Email").
- [ ] Confirm the placeholder reads `yourdexcomusername` (no `@`/email shape).
- [ ] Confirm the keyboard that appears is the default keyboard, not the `@`-prominent email keyboard.
- [ ] Confirm requirement bullet #2 reads: "Use your Dexcom username — not your email. Find it in the Dexcom app under Settings → Account."
- [ ] Confirm the lock-icon info-box mentions "username and password (not your email)".
- [ ] Type only a password and tap Connect → "Missing Info" alert says "Please enter both username and password."
- [ ] Type `someone@example.com` plus a password and tap Connect → "Use Your Dexcom Username" alert appears, no network request fires (verify no spinner). Tap OK and confirm the form is preserved.
- [ ] Type a username without `@` and a password and tap Connect → existing Dexcom auth flow runs (success or backend error), unchanged from before.

Libre path:

- [ ] Switch to **FreeStyle Libre**.
- [ ] Field label still reads **LibreLink Email**, placeholder is still `your@email.com`, email keyboard appears.
- [ ] Type only a password and tap Connect → "Missing Info" alert says "Please enter both email and password."
- [ ] Type `someone@example.com` and a password → existing Libre connect flow runs (the new `@` validation does NOT trigger).

Cross-cutting:

- [ ] No new TypeScript or lint errors.
- [ ] Disconnect flow still works for both providers.
- [ ] Switching CGM type back and forth does not change the validation behavior unexpectedly.
