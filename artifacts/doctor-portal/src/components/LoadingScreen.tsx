import { Activity } from "lucide-react";

export function LoadingScreen({ message = "Connecting to patient data..." }: { message?: string }) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background">
      <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mb-6 animate-pulse">
        <Activity className="w-10 h-10 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Gluco Guardian</h2>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
