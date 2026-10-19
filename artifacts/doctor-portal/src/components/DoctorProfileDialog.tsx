import { useEffect, useRef, useState } from "react";
import { Camera, Trash2, ShieldAlert } from "lucide-react";
import { ApiError, customFetch, type DoctorProfile } from "@doctor-portal/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PatientAvatar } from "@/components/PatientAvatar";
import { useDoctorSession } from "@/auth/mock-session";

const NO_TITLE = "none";
const TITLE_OPTIONS = ["Dr.", "NP", "PA", "RN", "PharmD"] as const;

// Map a leading honorific token to its canonical option so a legacy account (which only has a
// combined displayName like "Dr. Alex Rivera") still prefills Title/First/Last.
const TITLE_MAP: Record<string, string> = {
  dr: "Dr.",
  np: "NP",
  pa: "PA",
  rn: "RN",
  pharmd: "PharmD",
  md: "Dr.",
  do: "Dr.",
};

function parseDisplayName(displayName?: string): {
  title: string;
  firstName: string;
  lastName: string;
} {
  const tokens = (displayName || "").trim().split(/\s+/).filter(Boolean);
  let title = "";
  if (tokens.length > 1) {
    const key = tokens[0].toLowerCase().replace(/\./g, "");
    if (TITLE_MAP[key]) {
      title = TITLE_MAP[key];
      tokens.shift();
    }
  }
  const firstName = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : tokens[0] || "";
  const lastName = tokens.length > 1 ? tokens[tokens.length - 1] : "";
  return { title, firstName, lastName };
}
export const SPECIALTY_SUGGESTIONS = [
  "Endocrinology",
  "Pediatric Endocrinology",
  "Pediatrics",
  "Internal Medicine",
  "Family Medicine",
  "Diabetes Educator (CDE)",
];

/** Downscale a chosen image to a small square-ish JPEG data-URI so it fits comfortably on the account. */
function resizeImage(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas context"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("bad image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function DoctorProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { doctor, actions } = useDoctorSession();
  const [title, setTitle] = useState("Dr.");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed from the account each time the dialog opens. Fall back to parsing the combined
  // displayName so accounts predating the structured name/title fields still open pre-filled.
  useEffect(() => {
    if (open && doctor) {
      const parsed = parseDisplayName(doctor.displayName);
      setTitle(doctor.title || parsed.title || NO_TITLE);
      setFirstName(doctor.firstName || parsed.firstName);
      setLastName(doctor.lastName || parsed.lastName);
      setSpecialty(doctor.specialty || "");
      setEmail(doctor.email || "");
      setPhoto(doctor.photoDataUri);
      setErr(null);
    }
  }, [open, doctor]);

  const titleOut = title === NO_TITLE ? "" : title;
  const previewName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Your name";

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-choosing the same file
    if (!file) return;
    try {
      setPhoto(await resizeImage(file));
    } catch {
      setErr("Couldn't read that image. Try a different photo.");
    }
  }

  async function save() {
    const first = firstName.trim();
    const last = lastName.trim();
    const at = email.trim().toLowerCase();
    if (!first || !last) {
      setErr("First and last name are required.");
      return;
    }
    if (!at.includes("@")) {
      setErr("Enter a valid work email.");
      return;
    }
    const displayName = [titleOut, first, last].filter(Boolean).join(" ");
    const patch = {
      displayName,
      title: titleOut,
      firstName: first,
      lastName: last,
      specialty: specialty.trim(),
      email: at,
      photoDataUri: photo ?? "",
    };

    setSaving(true);
    setErr(null);
    // Best-effort server persist. Until the backend PATCH route is deployed this throws, so we still
    // apply the change to the current session so the portal reflects it immediately.
    let saved: DoctorProfile | null = null;
    try {
      saved = await customFetch<DoctorProfile>("/api/doctor/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr("That email is already registered to another account.");
        setSaving(false);
        return;
      }
      saved = null; // route not available yet → fall back to a local (session-only) update
    }

    actions.updateDoctor(
      saved ?? {
        displayName,
        title: titleOut || undefined,
        firstName: first,
        lastName: last,
        specialty: specialty.trim() || undefined,
        email: at,
        photoDataUri: photo,
      },
    );
    setSaving(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Edit your profile</DialogTitle>
          <DialogDescription>
            Your name, title, and specialty appear across the portal; the title and last name are
            what patients see on treatment changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <PatientAvatar name={previewName} photoDataUri={photo} className="w-16 h-16 text-lg" />
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={pickPhoto}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Camera className="w-4 h-4 mr-1.5" /> {photo ? "Change photo" : "Upload photo"}
              </Button>
              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto(undefined)}
                  className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove photo
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-3">
            <div>
              <Label htmlFor="pf-title">Title</Label>
              <Select value={title} onValueChange={setTitle}>
                <SelectTrigger id="pf-title" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TITLE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_TITLE}>No title</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pf-first">First name</Label>
              <Input
                id="pf-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1.5"
                autoComplete="given-name"
              />
            </div>
            <div>
              <Label htmlFor="pf-last">Last name</Label>
              <Input
                id="pf-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1.5"
                autoComplete="family-name"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="pf-specialty">Specialty / position</Label>
            <Input
              id="pf-specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="e.g. Pediatric Endocrinology"
              className="mt-1.5"
              list="specialty-suggestions"
            />
            <datalist id="specialty-suggestions">
              {SPECIALTY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div>
            <Label htmlFor="pf-email">Work email</Label>
            <Input
              id="pf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground mt-1">
              You'll sign in with this email next time.
            </p>
          </div>

          {err && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{err}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
