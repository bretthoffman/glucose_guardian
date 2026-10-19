import { useState } from "react";
import { FlaskConical, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readLabA1c, useSetLabA1c, type LabA1cInfo } from "@/data/doctor-data";
import { formatDate } from "@/lib/utils";

/**
 * Lab-measured A1C: shows the recorded value against the CGM-estimated GMI and lets the doctor
 * record/update it. The estimate builds trust only when it can be checked against the lab — this
 * is that check, one line under the GMI.
 */
export function LabA1cRecord({
  snapshot,
  accessCode,
  estimated,
}: {
  snapshot: unknown;
  accessCode: string;
  estimated?: number | null;
}) {
  const [saved, setSaved] = useState<LabA1cInfo | undefined>(undefined);
  const lab = saved ?? readLabA1c(snapshot);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const { save, isPending } = useSetLabA1c(accessCode);

  const delta =
    lab && estimated != null ? Math.round((estimated - lab.value) * 10) / 10 : null;

  async function submit() {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 3 || v > 20) {
      setErr("Enter an A1C between 3 and 20%.");
      return;
    }
    setErr(null);
    try {
      const s = await save(v, new Date(`${date}T12:00:00`).toISOString());
      setSaved(s);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/60">
      {lab ? (
        <p className="text-xs text-muted-foreground">
          <FlaskConical className="w-3 h-3 inline -mt-0.5 mr-1" />
          Lab A1C <span className="font-semibold text-foreground">{lab.value}%</span> ·{" "}
          {formatDate(lab.measuredAt)}
          {delta != null && (
            <span className="ml-1">
              {delta === 0
                ? "(matches estimate)"
                : `(estimate ${delta > 0 ? "+" : ""}${delta} vs lab)`}
            </span>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">No lab A1C recorded yet.</p>
      )}
      <button
        onClick={() => {
          setValue(lab ? String(lab.value) : "");
          setErr(null);
          setOpen(true);
        }}
        className="text-xs text-primary hover:underline mt-0.5"
      >
        {lab ? "Update lab A1C" : "Record lab A1C"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Record lab A1C</DialogTitle>
            <DialogDescription>
              The lab value is shown beside the CGM-estimated GMI so you can gauge how well the
              estimate tracks this patient.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="lab-a1c-value">A1C (%)</Label>
              <Input
                id="lab-a1c-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="7.2"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="lab-a1c-date">Measured on</Label>
              <Input
                id="lab-a1c-date"
                type="date"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5"
              />
            </div>
            {err && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{err}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending || !value.trim()}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
