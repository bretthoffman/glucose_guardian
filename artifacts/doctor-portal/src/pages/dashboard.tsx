import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetPatientData } from "@workspace/api-client-react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { 
  Activity, LayoutDashboard, LineChart, Syringe, 
  Apple, MessageCircle, LogOut, Settings, Bell
} from "lucide-react";

// Sub-panels
import { OverviewPanel } from "@/components/panels/OverviewPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { InsulinPanel } from "@/components/panels/InsulinPanel";
import { MessagesPanel } from "@/components/panels/MessagesPanel";

export default function Dashboard() {
  const [match, params] = useRoute("/dashboard/:tab");
  const [, setLocation] = useLocation();
  const { accessCode, isAuthenticated, logout, isReady, patientName } = useAuth();
  
  const currentTab = params?.tab || "overview";

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isReady, isAuthenticated, setLocation]);

  const { data: patientData, isLoading, error } = useGetPatientData(accessCode || "", {
    query: {
      enabled: !!accessCode,
      refetchInterval: 30000, // poll every 30s
    }
  });

  if (!isReady || isLoading) {
    return <LoadingScreen />;
  }

  if (error || !patientData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md p-6 bg-card rounded-2xl border border-border">
          <Activity className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Patient Data Unavailable</h2>
          <p className="text-muted-foreground text-sm">
            We couldn't load data for this access code. The patient may need to connect to the internet to sync their data.
          </p>
          <button onClick={logout} className="text-primary hover:underline mt-4">
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "chart", label: "CGM Chart", icon: LineChart },
    { id: "insulin", label: "Insulin Log", icon: Syringe },
    // { id: "food", label: "Food Log", icon: Apple }, // Placeholder, can be added similar to Insulin
    { id: "messages", label: "Messages", icon: MessageCircle },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border flex flex-col shrink-0">
        <div className="p-6 border-b border-border/50 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg text-foreground tracking-tight">Gluco Guardian</span>
        </div>

        <div className="p-4 border-b border-border/50 bg-secondary/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Current Patient</p>
          <p className="font-medium text-foreground truncate">{patientData.profile.childName}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setLocation(`/dashboard/${item.id}`)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-sm" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "opacity-70"}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors duration-200"
          >
            <LogOut className="w-5 h-5 opacity-70" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative bg-background">
        <div className="max-w-6xl mx-auto p-6 lg:p-8">
          <div key={currentTab} className="animate-fade-in">
            {currentTab === "overview" && <OverviewPanel data={patientData} />}
            {currentTab === "chart" && <ChartPanel data={patientData} />}
            {currentTab === "insulin" && <InsulinPanel data={patientData} />}
            {currentTab === "messages" && <MessagesPanel accessCode={accessCode!} patientName={patientData.profile.childName} />}
            {currentTab !== "overview" && currentTab !== "chart" && currentTab !== "insulin" && currentTab !== "messages" && (
              <div className="py-20 text-center text-muted-foreground">Module under construction</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
