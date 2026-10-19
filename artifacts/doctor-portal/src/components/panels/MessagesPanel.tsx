import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Briefcase, Send, Stethoscope, User, Users } from "lucide-react";
import { useGetDoctorMessages, useSendDoctorMessage } from "@doctor-portal/api-client-react";
import { formatTime, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCareCircle, useNurseMessaging, useNurseThreads } from "@/data/doctor-data";
import { CaregiverName, useCaregiverTitleLookup } from "@/components/CaregiverName";

interface ChatItem {
  id: string;
  text: string;
  fromDoctor: boolean;
  /** ISO timestamp. */
  at: string;
}

function ChatMessages({ items, emptyText }: { items: ChatItem[]; emptyText: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
      {items.length === 0 ? (
        <div className="text-center text-muted-foreground py-10">{emptyText}</div>
      ) : (
        items.map((msg, i) => {
          const showDate =
            i === 0 || new Date(msg.at).toDateString() !== new Date(items[i - 1].at).toDateString();
          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center my-4">
                  <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full border border-border">
                    {formatDate(msg.at)}
                  </span>
                </div>
              )}
              <div className={`flex ${msg.fromDoctor ? "justify-end" : "justify-start"} mb-4`}>
                <div
                  className={`flex max-w-[75%] ${msg.fromDoctor ? "flex-row-reverse" : "flex-row"} items-end gap-2`}
                >
                  <div className="shrink-0">
                    {msg.fromDoctor ? (
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
                        <Stethoscope className="w-4 h-4 text-primary-foreground" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div
                    className={`px-4 py-3 rounded-2xl shadow-sm ${
                      msg.fromDoctor
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border text-foreground rounded-bl-sm"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                    <span
                      className={`text-[10px] mt-1 block opacity-70 ${msg.fromDoctor ? "text-right" : "text-left"}`}
                    >
                      {formatTime(msg.at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function Composer({ onSend, pending }: { onSend: (text: string) => Promise<void>; pending: boolean }) {
  const [text, setText] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    try {
      await onSend(trimmed);
      setText("");
    } catch {
      // Keep the draft so it can be re-sent; the sender already showed why it failed.
    }
  };
  return (
    <div className="p-4 bg-background border-t border-border" data-tour="messages-input">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-card"
          disabled={pending}
        />
        <Button type="submit" size="icon" disabled={!text.trim() || pending} className="shrink-0">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * Doctor messaging, limited to parents and school nurses. "Parents" is the guardian thread every
 * guardian account sees in the app; each caregiver the doctor tagged School Nurse gets their own
 * chat, which the nurse sees in the app's Care Circle messages. Family members never get one.
 */
export function MessagesPanel({ accessCode, patientName }: { accessCode: string; patientName: string }) {
  const search = useSearch();
  const [active, setActive] = useState(() => new URLSearchParams(search).get("to") ?? "parents");
  useEffect(() => {
    const to = new URLSearchParams(search).get("to");
    if (to) setActive(to);
  }, [search]);

  const { toast } = useToast();
  const members = useCareCircle(accessCode);
  const nurseThreads = useNurseThreads(accessCode);
  const nurse = useNurseMessaging(accessCode);
  const titleOf = useCaregiverTitleLookup();

  const { data } = useGetDoctorMessages(accessCode, {
    // @ts-expect-error Generated hook merges partial query options at runtime
    query: { refetchInterval: 10000 },
  });
  const sendParents = useSendDoctorMessage();
  const [nursePending, setNursePending] = useState(false);

  const guardians = (members ?? []).filter((m) => m.messaging === "parents");
  // Guardian accounts all read the parents' thread in the app, so a family member with one can too.
  const nonParentGuardians = guardians.filter((g) => {
    const t = titleOf(g.name)?.title;
    return t === "family_member" || t === "organization";
  });
  const activeNurse = nurseThreads?.find((th) => th.codeId === active) ?? null;
  const showingParents = !activeNurse;

  useEffect(() => {
    if (activeNurse && activeNurse.unread > 0) nurse.markRead(activeNurse.codeId);
  }, [activeNurse?.codeId, activeNurse?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentItems = useMemo<ChatItem[]>(
    () =>
      (data?.messages ?? []).map((m) => ({
        id: m.id,
        text: m.text,
        fromDoctor: m.sender === "doctor",
        at: m.timestamp,
      })),
    [data?.messages],
  );
  const nurseItems = useMemo<ChatItem[]>(
    () =>
      (activeNurse?.messages ?? []).map((m) => ({
        id: m.id,
        text: m.text,
        fromDoctor: m.fromDoctor,
        at: new Date(m.createdAt).toISOString(),
      })),
    [activeNurse?.messages],
  );

  const sendToParents = (text: string) =>
    new Promise<void>((resolve, reject) =>
      sendParents.mutate(
        { accessCode, data: { text, sender: "doctor" } },
        {
          onSuccess: () => resolve(),
          onError: () => {
            toast({ title: "Message not sent", description: "Try again.", variant: "destructive" });
            reject(new Error("Message not sent"));
          },
        },
      ),
    );
  const sendToNurse = async (text: string) => {
    if (!activeNurse) return;
    setNursePending(true);
    try {
      await nurse.send(activeNurse.codeId, text);
    } catch (e) {
      toast({
        title: "Message not sent",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
      throw e;
    } finally {
      setNursePending(false);
    }
  };

  const convoClass = (on: boolean) =>
    `w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
      on ? "border-primary/30 bg-primary/10" : "border-transparent hover:bg-secondary/50"
    }`;

  return (
    <Card className="h-[calc(100vh-230px)] min-h-[440px] flex border-border rounded-2xl overflow-hidden">
      {/* Conversations — parents and school nurses only */}
      <aside className="w-64 shrink-0 border-r border-border bg-secondary/20 flex flex-col">
        <p className="px-4 pt-4 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          Conversations
        </p>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          <button onClick={() => setActive("parents")} className={convoClass(showingParents)}>
            <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Parents</span>
              <span className="block text-[11px] text-muted-foreground truncate">
                {guardians.length ? guardians.map((g) => g.name).join(", ") : `${patientName}'s guardian`}
              </span>
            </span>
          </button>
          {(nurseThreads ?? []).map((th) => (
            <button key={th.codeId} onClick={() => setActive(th.codeId)} className={convoClass(active === th.codeId)}>
              <Briefcase className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground truncate">{th.name}</span>
                <span className="block text-[11px] text-muted-foreground">School nurse</span>
              </span>
              {th.unread > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {th.unread}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="px-4 py-3 text-[11px] text-muted-foreground border-t border-border leading-snug">
          {nurseThreads === null
            ? "School-nurse chats turn on with the next backend update."
            : "Only parents and school nurses can be messaged. Tag a caregiver as School Nurse in the Care Circle to start a chat with them."}
        </p>
      </aside>

      {/* Active conversation */}
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="bg-secondary/50 border-b border-border p-4">
          {showingParents ? (
            <>
              <h3 className="font-semibold text-foreground">Parents</h3>
              <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5">
                {guardians.length ? (
                  <>
                    <span>Read in the app by</span>
                    {guardians.map((g) => (
                      <CaregiverName key={g.id} name={g.name} />
                    ))}
                  </>
                ) : (
                  <span>{patientName}'s guardian, in the Glucose Guardian app</span>
                )}
              </p>
              {nonParentGuardians.length > 0 && (
                <p className="text-[11px] text-amber-600 flex items-start gap-1.5 mt-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    {nonParentGuardians.map((g) => g.name).join(", ")}{" "}
                    {nonParentGuardians.length === 1 ? "has" : "have"} a guardian account, so this
                    thread is visible to them too. Hiding it from family members needs an app update.
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <CaregiverName name={activeNurse!.name} />
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Private chat — they see it in the app's Care Circle messages.
              </p>
            </>
          )}
        </div>

        {showingParents ? (
          <>
            <ChatMessages
              items={parentItems}
              emptyText="No messages yet. Send a message to start the conversation."
            />
            <Composer onSend={sendToParents} pending={sendParents.isPending} />
          </>
        ) : (
          <>
            <ChatMessages
              items={nurseItems}
              emptyText={`No messages yet. ${activeNurse!.name} will see your message in the app.`}
            />
            <Composer onSend={sendToNurse} pending={nursePending} />
          </>
        )}
      </section>
    </Card>
  );
}
