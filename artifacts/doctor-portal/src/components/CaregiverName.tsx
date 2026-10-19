import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, Syringe, Utensils } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useCaregiverTitles, useSetCaregiverTitle } from "@/data/doctor-data";
import {
  CAREGIVER_TITLE_OPTIONS,
  caregiverKey,
  titleLabel,
  type CaregiverTitle,
  type CaregiverTitleEntry,
} from "@/data/caregivers";

interface CaregiverTitlesValue {
  titleFor: (name: string) => CaregiverTitleEntry | undefined;
  /** False until the backend supports titles — names then render without the picker. */
  editable: boolean;
  save: (name: string, title: CaregiverTitle | null, detail?: string) => Promise<void>;
}

const CaregiverTitlesContext = createContext<CaregiverTitlesValue | null>(null);

/** Loads this doctor's caregiver titles for the patient on screen. */
export function CaregiverTitlesProvider({
  accessCode,
  children,
}: {
  accessCode: string;
  children: ReactNode;
}) {
  const { titles } = useCaregiverTitles(accessCode);
  const { save } = useSetCaregiverTitle(accessCode);
  const value = useMemo<CaregiverTitlesValue>(() => {
    const byKey = new Map((titles ?? []).map((t) => [caregiverKey(t.name), t]));
    return { titleFor: (name) => byKey.get(caregiverKey(name)), editable: titles != null, save };
  }, [titles, save]);
  return <CaregiverTitlesContext.Provider value={value}>{children}</CaregiverTitlesContext.Provider>;
}

/** This doctor's title entry for a name, if they've set one. */
export function useCaregiverTitleLookup(): (name: string) => CaregiverTitleEntry | undefined {
  const ctx = useContext(CaregiverTitlesContext);
  return (name) => ctx?.titleFor(name);
}

/** "Holly (Mother)" as plain text — for exports and tooltips. */
export function useCaregiverLabel(): (name: string) => string {
  const ctx = useContext(CaregiverTitlesContext);
  return (name) => {
    const entry = ctx?.titleFor(name);
    return entry ? `${name} (${titleLabel(entry)})` : name;
  };
}

function TitlePicker({
  name,
  entry,
  save,
  onDone,
}: {
  name: string;
  entry?: CaregiverTitleEntry;
  save: CaregiverTitlesValue["save"];
  onDone: () => void;
}) {
  const [title, setTitle] = useState<CaregiverTitle | null>(entry?.title ?? null);
  const [detail, setDetail] = useState(entry?.detail ?? "");
  const [pending, setPending] = useState(false);
  const { toast } = useToast();
  const option = CAREGIVER_TITLE_OPTIONS.find((o) => o.value === title);

  const submit = async (next: CaregiverTitle | null) => {
    setPending(true);
    try {
      await save(name, next, next ? detail : undefined);
      onDone();
    } catch (e) {
      toast({
        title: "Title not saved",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-sm font-medium text-foreground">Who is {name}?</p>
        <p className="text-[11px] text-muted-foreground">Only you see this title.</p>
      </div>
      <div className="grid gap-0.5">
        {CAREGIVER_TITLE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setTitle(o.value)}
            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
              title === o.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-transparent text-foreground hover:bg-secondary"
            }`}
          >
            <span>
              {o.label}
              {o.value === "organization" && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">Church, etc.</span>
              )}
            </span>
            {title === o.value && <Check className="w-3.5 h-3.5 shrink-0" />}
          </button>
        ))}
      </div>
      {title && (
        <Input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={60}
          placeholder={option?.detailHint}
          className="h-8 text-sm"
          aria-label="Details (optional)"
        />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!title || pending} onClick={() => submit(title)}>
          Save
        </Button>
        {entry && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(null)}>
            Remove title
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A Care Circle member's name with the doctor's title ("Holly · Mother"). Click to set the title.
 * Pass `interactive={false}` inside another clickable element (a button can't hold a button).
 */
export function CaregiverName({
  name,
  interactive = true,
  className = "",
}: {
  name: string;
  interactive?: boolean;
  className?: string;
}) {
  const ctx = useContext(CaregiverTitlesContext);
  const [open, setOpen] = useState(false);
  const entry = ctx?.titleFor(name);
  const canEdit = interactive && !!ctx?.editable;

  const label = (
    <>
      <span className="font-medium text-foreground whitespace-nowrap">{name}</span>
      {entry ? (
        <span className="text-[10px] px-1.5 py-px rounded-full border border-primary/30 bg-primary/10 text-primary whitespace-nowrap">
          {titleLabel(entry)}
        </span>
      ) : (
        canEdit && (
          <span className="text-[10px] px-1.5 py-px rounded-full border border-dashed border-border text-muted-foreground whitespace-nowrap">
            + title
          </span>
        )
      )}
    </>
  );

  if (!canEdit) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 ${className}`}>
        {label}
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={entry ? `Change ${name}'s title` : `Who is ${name}? Add a title`}
          className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 text-left rounded-md hover:bg-secondary/60 px-0.5 -mx-0.5 transition-colors ${className}`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <TitlePicker name={name} entry={entry} save={ctx.save} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Who logged a meal and who logged its insulin — one name when it's the same person. Nothing for
 * older entries logged before Care Circle recorded authors.
 */
export function WhoLogged({
  mealBy,
  doseBy,
  interactive = true,
  className = "",
}: {
  mealBy?: string | null;
  doseBy?: string | null;
  interactive?: boolean;
  className?: string;
}) {
  if (!mealBy && !doseBy) return null;
  const same = !!mealBy && !!doseBy && caregiverKey(mealBy) === caregiverKey(doseBy);
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      {same ? (
        <span className="inline-flex items-center gap-1 min-w-0">
          Meal &amp; insulin by <CaregiverName name={mealBy!} interactive={interactive} />
        </span>
      ) : (
        <>
          {mealBy && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <Utensils className="w-3 h-3 shrink-0" /> Meal by{" "}
              <CaregiverName name={mealBy} interactive={interactive} />
            </span>
          )}
          {doseBy && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <Syringe className="w-3 h-3 shrink-0" /> Insulin by{" "}
              <CaregiverName name={doseBy} interactive={interactive} />
            </span>
          )}
        </>
      )}
    </span>
  );
}
