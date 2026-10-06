/**
 * Every doctor-portal function is called by the api-server only, which proves itself with the
 * shared CONVEX_DOCTOR_API_SECRET. Kept free of Convex function definitions so both the default
 * runtime and the Node actions ("use node") can import it.
 */
export function requireDoctorApiSecret(provided: string) {
  const expected = process.env.CONVEX_DOCTOR_API_SECRET;
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized doctor API");
  }
}
