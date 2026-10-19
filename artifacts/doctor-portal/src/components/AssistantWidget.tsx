import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { ApiError, customFetch } from "@doctor-portal/api-client-react";
import { Input } from "@/components/ui/input";
import { useCurrentDoctor } from "@/auth/use-current-doctor";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const SUGGESTIONS = [
  "What's the average glucose over the last 30 days?",
  "How is time in range this week vs last week?",
  "Any overnight lows recently?",
  "Summarize the response since the last setting change.",
];

/**
 * "Ask Glucose Guardian" — a floating, patient-scoped assistant on the patient page. The server
 * gathers all patient context itself (this widget sends only the conversation), so answers are
 * grounded in the currently-viewed patient's record and nothing else.
 */
export function AssistantWidget({
  accessCode,
  patientName,
}: {
  accessCode: string;
  patientName: string;
}) {
  const access = useCurrentDoctor();
  const doctorName = access.status === "active" ? access.doctor.displayName : "Doctor";

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new patient means a new conversation — the assistant is scoped to who you're viewing.
  useEffect(() => {
    setTurns([]);
    setInput("");
    setBusy(false);
  }, [accessCode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, open]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      const history = [...turns, { role: "user" as const, content: q }];
      setTurns(history);
      try {
        const r = await customFetch<{ reply: string }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/assistant`,
          {
            method: "POST",
            body: JSON.stringify({
              messages: history.slice(-12),
              tzOffset: new Date().getTimezoneOffset(),
            }),
          },
        );
        setTurns([...history, { role: "assistant", content: r.reply }]);
      } catch (e) {
        const msg =
          e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 503)
            ? "I'm not available yet — the assistant activates with the next backend deployment."
            : "I had trouble answering that. Give it another try in a moment.";
        setTurns([...history, { role: "assistant", content: msg }]);
      } finally {
        setBusy(false);
      }
    },
    [accessCode, busy, turns],
  );

  if (!open) {
    return (
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-2 max-w-[calc(100vw-3rem)]">
        <span className="px-3 py-1.5 rounded-full bg-card border border-border shadow-lg text-xs font-medium text-foreground max-w-[220px] truncate">
          Ask about {patientName}'s care
        </span>
        <button
          onClick={() => setOpen(true)}
          title={`Ask Glucose Guardian about ${patientName}'s care`}
          aria-label="Ask Glucose Guardian"
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/25 flex items-center justify-center hover:scale-105 transition-transform self-end"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[540px] max-h-[calc(100vh-5rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2.5 bg-secondary/40">
        <span className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground leading-tight">Glucose Guardian</p>
          <p className="text-[11px] text-muted-foreground truncate">
            Assistant · {patientName}'s data only
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3 h-3 text-primary" />
          </span>
          <div className="bg-secondary/50 border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground max-w-[85%]">
            {timeOfDay()}, {doctorName} — how can I help you with {patientName}'s data today?
          </div>
        </div>

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3 h-3 text-primary" />
              </span>
              <div className="bg-secondary/50 border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground max-w-[85%] whitespace-pre-wrap">
                {t.content}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-start gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-3 h-3 text-primary" />
            </span>
            <div className="bg-secondary/50 border border-border rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:120ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:240ms]" />
            </div>
          </div>
        )}

        {turns.length === 0 && !busy && (
          <div className="pt-1 space-y-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="block w-full text-left text-xs px-3 py-2 rounded-xl border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="p-3 border-t border-border flex items-center gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${patientName}'s data…`}
          className="flex-1"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
