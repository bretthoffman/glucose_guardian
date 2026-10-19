import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDoctorSession } from "../mock-session";
import { AuthShell } from "./auth-shell";

export function PinLock() {
  const { doctor, attemptsLeft, actions } = useDoctorSession();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const ok = await actions.unlock(pin);
      if (!ok) {
        setErr(
          `Incorrect PIN. ${Math.max(0, attemptsLeft - 1)} attempt(s) left before full login.`,
        );
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Locked" subtitle={doctor?.email}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground text-center">
          Enter your PIN to resume your session.
        </p>
        <Input
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => {
            setErr(null);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          }}
          className="text-center tracking-[0.5em] text-lg"
          placeholder="••••"
        />
        {err && <p className="text-sm text-destructive text-center">{err}</p>}
        <Button type="submit" className="w-full h-12" disabled={busy || pin.length !== 4}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
      <button
        onClick={() => actions.signOut()}
        className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Use full login instead
      </button>
    </AuthShell>
  );
}
