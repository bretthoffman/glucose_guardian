import { useState } from "react";
import { Activity, ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDoctorLogin } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

export default function Login() {
  const [code, setCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const { login } = useAuth();

  const loginMutation = useDoctorLogin();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!code.trim()) {
      setErrorMsg("Please enter an access code.");
      return;
    }

    loginMutation.mutate(
      { data: { accessCode: code.trim() } },
      {
        onSuccess: (res) => {
          if (res.success) {
            login(res.accessCode, res.patientName ?? undefined);
          } else {
            setErrorMsg("Invalid access code.");
          }
        },
        onError: () => {
          setErrorMsg("Invalid access code or network error.");
        },
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/login-bg.png`}
          alt="Abstract medical background"
          className="w-full h-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/95 to-background" />
      </div>

      <div className="w-full max-w-md p-6 relative z-10">
        <div className="bg-card border border-border rounded-2xl p-8 sm:p-10 text-center shadow-xl">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-primary/30">
            <Activity className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-3xl font-bold text-foreground mb-2">Gluco Guardian</h1>
          <p className="text-muted-foreground mb-8">Doctor & Care Team Portal</p>

          <form onSubmit={handleLogin} className="space-y-5 text-left">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Patient Access Code
              </label>
              <Input
                type="text"
                placeholder="e.g. DR-SMITH-2024"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="text-lg uppercase tracking-widest"
                autoComplete="off"
              />
            </div>

            {errorMsg && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{errorMsg}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-14 text-base mt-4"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Verifying..." : "Access Patient Data"}
              {!loginMutation.isPending && <ArrowRight className="w-5 h-5 ml-2" />}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Secure, read-only access to pediatric diabetes data.
        </p>
      </div>
    </div>
  );
}
