/**
 * Client-side password encoding — must match the backend / mobile app exactly
 * (artifacts/mobile/context/AuthContext.tsx `hashPassword`). It's reversible, so it isn't the
 * protection: the backend stores only a salted scrypt digest of what this returns
 * (glucose_guardian convex/doctorAuth/passwordNode.ts), and HTTPS protects it in transit.
 */
export function hashPassword(password: string): string {
  const salted = `gg::${password}::glucose_guardian_2025`;
  let encoded = "";
  for (let i = 0; i < salted.length; i++) {
    encoded += salted.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return encoded;
}
