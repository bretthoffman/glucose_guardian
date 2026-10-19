const HONORIFICS = new Set([
  "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "np", "pa", "rn", "do", "md", "pharmd",
]);

/** Initials from a name, skipping a leading honorific so "Dr. Alex Rivera" → "AR" (not "DA"). */
function computeInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const meaningful = parts.filter((p) => !HONORIFICS.has(p.toLowerCase()));
  const use = meaningful.length ? meaningful : parts;
  return use.map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/**
 * Patient/doctor avatar: shows the profile photo synced from the Glucose Guardian app or set in the
 * portal when present (a small base64 data-URI on photoDataUri), otherwise initials. Only data:
 * image URIs are rendered — anything else (e.g. a device-local file path) falls back to initials.
 */
export function PatientAvatar({
  name,
  photoDataUri,
  className = "w-11 h-11 text-sm",
}: {
  name: string;
  photoDataUri?: string;
  className?: string;
}) {
  const initials = computeInitials(name);

  if (photoDataUri?.startsWith("data:image/")) {
    return (
      <img
        src={photoDataUri}
        alt={name}
        className={`${className} rounded-full object-cover border border-primary/30 shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-display font-bold shrink-0`}
    >
      {initials}
    </div>
  );
}
