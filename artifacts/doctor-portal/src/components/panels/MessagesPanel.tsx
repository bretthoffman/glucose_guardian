import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, User, Stethoscope } from "lucide-react";
import { useGetDoctorMessages, useSendDoctorMessage } from "@workspace/api-client-react";
import { formatTime, formatDate } from "@/lib/utils";

export function MessagesPanel({ accessCode, patientName }: { accessCode: string, patientName: string }) {
  const [inputText, setInputText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { data, isLoading } = useGetDoctorMessages(accessCode, {
    query: { refetchInterval: 10000 } // poll every 10s
  });
  
  const sendMutation = useSendDoctorMessage();

  const messages = data?.messages || [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sendMutation.isPending) return;

    sendMutation.mutate({
      accessCode,
      data: { text: inputText.trim(), sender: "doctor" }
    }, {
      onSuccess: () => {
        setInputText("");
      }
    });
  };

  return (
    <Card className="h-[calc(100vh-140px)] flex flex-col border-border overflow-hidden">
      {/* Chat Header */}
      <div className="bg-secondary/50 border-b border-border p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Chat with {patientName}'s Guardian</h3>
          <p className="text-xs text-muted-foreground">They use the Gluco Guardian mobile app</p>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {isLoading && messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-10">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-10">
            No messages yet. Send a message to start the conversation.
          </div>
        ) : (
          messages.map((msg, i) => {
            const isDoc = msg.sender === "doctor";
            const showDate = i === 0 || new Date(msg.timestamp).toDateString() !== new Date(messages[i-1].timestamp).toDateString();
            
            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex justify-center my-4">
                    <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full border border-border">
                      {formatDate(msg.timestamp)}
                    </span>
                  </div>
                )}
                <div className={`flex ${isDoc ? 'justify-end' : 'justify-start'} mb-4 group`}>
                  <div className={`flex max-w-[75%] ${isDoc ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                    
                    {/* Avatar */}
                    <div className="shrink-0">
                      {isDoc ? (
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
                          <Stethoscope className="w-4 h-4 text-primary-foreground" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center">
                          <User className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Bubble */}
                    <div className={`
                      px-4 py-3 rounded-2xl shadow-sm relative
                      ${isDoc 
                        ? 'bg-primary text-primary-foreground rounded-br-sm' 
                        : 'bg-card border border-border text-foreground rounded-bl-sm'
                      }
                    `}>
                      <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                      <span className={`text-[10px] mt-1 block opacity-70 ${isDoc ? 'text-right' : 'text-left'}`}>
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>

                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background border-t border-border">
        <form onSubmit={handleSend} className="flex gap-2">
          <Input 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-card"
            disabled={sendMutation.isPending}
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!inputText.trim() || sendMutation.isPending}
            className="shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}
