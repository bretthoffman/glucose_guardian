import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PatientList } from "@/pages/patient-list";
import { PatientDetail } from "@/pages/patient-detail";
import NotFound from "@/pages/not-found";
import { AuthGate } from "@/auth/auth-gate";
import { DoctorSessionProvider } from "@/auth/mock-session";
import { DemoBanner } from "@/demo/DemoUi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/">
        <AuthGate>
          <PatientList />
        </AuthGate>
      </Route>
      <Route path="/patient/:accessCode/:tab">
        {(params) => (
          <AuthGate>
            <PatientDetail accessCode={params.accessCode ?? ""} tab={params.tab ?? "overview"} />
          </AuthGate>
        )}
      </Route>
      <Route path="/patient/:accessCode">
        {(params) => <Redirect to={`/patient/${params.accessCode ?? ""}/overview`} />}
      </Route>
      {/* A shared demo link opens the home page; visitors choose "Try the demo" there. */}
      <Route path="/demo">
        <Redirect to="/" />
      </Route>
      {/* Legacy / retired routes send the doctor home (the auth flow gates from there). */}
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      <Route path="/dashboard/:tab">
        <Redirect to="/" />
      </Route>
      <Route path="/dashboard">
        <Redirect to="/" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DoctorSessionProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <DemoBanner />
          </WouterRouter>
        </DoctorSessionProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
