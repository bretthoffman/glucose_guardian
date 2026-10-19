import { BrandLogo } from "@/components/BrandLogo";

export function LoadingScreen({ message = "Connecting to patient data..." }: { message?: string }) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background">
      <BrandLogo className="w-20 h-20 mb-6 animate-pulse" />
      <h2 className="text-xl font-semibold text-foreground mb-2">Glucose Guardian</h2>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
