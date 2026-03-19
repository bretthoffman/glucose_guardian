import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, formatDate, calculateA1C, calculateTIR, getGlucoseColor } from "@/lib/utils";
import type { PatientSnapshot } from "@workspace/api-client-react";
import { Activity, Droplet, Clock, AlertTriangle, ArrowRight, ArrowUpRight, ArrowDownRight, ArrowUp, ArrowDown } from "lucide-react";

function TrendIcon({ trend }: { trend: string }) {
  switch (trend) {
    case "DoubleUp": return <ArrowUp className="w-4 h-4" />;
    case "SingleUp": return <ArrowUpRight className="w-4 h-4" />;
    case "FortyFiveUp": return <ArrowUpRight className="w-4 h-4 opacity-70" />;
    case "Flat": return <ArrowRight className="w-4 h-4" />;
    case "FortyFiveDown": return <ArrowDownRight className="w-4 h-4 opacity-70" />;
    case "SingleDown": return <ArrowDownRight className="w-4 h-4" />;
    case "DoubleDown": return <ArrowDown className="w-4 h-4" />;
    default: return <ArrowRight className="w-4 h-4" />;
  }
}

export function OverviewPanel({ data }: { data: PatientSnapshot }) {
  const currentReading = data.glucoseReadings?.[0];
  const estA1c = calculateA1C(data.glucoseReadings || []);
  const tir = calculateTIR(data.glucoseReadings || []);
  
  // Calculate today's insulin
  const today = new Date().toISOString().split('T')[0];
  const todayInsulin = data.insulinLog?.filter(log => log.timestamp.startsWith(today)).reduce((sum, log) => sum + log.units, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Patient Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <h2 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
            {data.profile.childName}
            <span className="px-3 py-1 bg-primary/20 text-primary text-sm rounded-full border border-primary/30">
              {data.profile.diabetesType === 'type1' ? 'Type 1' : data.profile.diabetesType === 'type2' ? 'Type 2' : 'Other'}
            </span>
          </h2>
          <p className="text-muted-foreground mt-2 flex items-center gap-4">
            <span>DOB: {formatDate(data.profile.dateOfBirth)}</span>
            {data.profile.weightLbs && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-border"></span>
                <span>{data.profile.weightLbs} lbs</span>
              </>
            )}
            <span className="w-1.5 h-1.5 rounded-full bg-border"></span>
            <span>Parent: {data.profile.parentName || 'N/A'}</span>
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground bg-secondary/50 px-4 py-2 rounded-lg border border-border">
          Last synced: {formatTime(data.syncedAt)}
        </div>
      </div>

      {/* Key Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-card/50 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Activity className="w-16 h-16" />
          </div>
          <CardContent className="p-6 relative z-10">
            <p className="text-sm font-medium text-muted-foreground mb-1">Current Glucose</p>
            <div className="flex items-baseline gap-3">
              <span className={`text-4xl font-display font-bold ${currentReading ? getGlucoseColor(currentReading.value).split(' ')[0] : 'text-foreground'}`}>
                {currentReading?.value || '--'}
              </span>
              <span className="text-lg text-muted-foreground">mg/dL</span>
              {currentReading && (
                <div className={`flex items-center justify-center w-8 h-8 rounded-full ${getGlucoseColor(currentReading.value)}`}>
                  <TrendIcon trend={currentReading.trend} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center shrink-0">
              <Activity className="w-6 h-6 text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Est. A1C (7d)</p>
              <p className="text-3xl font-display font-bold text-foreground">
                {estA1c ? `${estA1c}%` : '--'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-success/20 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-success" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Time in Range</p>
              <p className="text-3xl font-display font-bold text-foreground">
                {tir}%
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
              <Droplet className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Total Insulin Today</p>
              <p className="text-3xl font-display font-bold text-foreground">
                {todayInsulin.toFixed(1)} <span className="text-lg text-muted-foreground font-normal">u</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Readings Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Readings</CardTitle>
          </CardHeader>
          <CardContent>
            {data.glucoseReadings?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 rounded-t-lg">
                    <tr>
                      <th className="px-4 py-3 rounded-tl-lg">Time</th>
                      <th className="px-4 py-3">Glucose (mg/dL)</th>
                      <th className="px-4 py-3 rounded-tr-lg">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.glucoseReadings.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">{formatTime(r.timestamp)}</td>
                        <td className="px-4 py-3 font-medium">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getGlucoseColor(r.value)}`}>
                            {r.value}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <TrendIcon trend={r.trend} />
                            <span>{r.trend.replace(/([A-Z])/g, ' $1').trim()}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                No recent readings found.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Clinical Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                Alert Thresholds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-secondary/30 rounded-xl border border-border">
                  <span className="text-sm font-medium">Urgent High</span>
                  <span className="font-bold text-destructive">{data.alertPreferences?.urgentHighThreshold || 250}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-secondary/30 rounded-xl border border-border">
                  <span className="text-sm font-medium">High</span>
                  <span className="font-bold text-warning">{data.alertPreferences?.highThreshold || 180}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-secondary/30 rounded-xl border border-border">
                  <span className="text-sm font-medium">Low</span>
                  <span className="font-bold text-orange-500">{data.alertPreferences?.lowThreshold || 70}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-secondary/30 rounded-xl border border-border">
                  <span className="text-sm font-medium">Urgent Low</span>
                  <span className="font-bold text-destructive">{data.alertPreferences?.urgentLowThreshold || 55}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
             <CardHeader className="pb-3">
              <CardTitle>Ratios & Factors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Carb Ratio:</span>
                  <span className="font-medium text-foreground">1u : {data.profile.carbRatio || 15}g</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Correction Factor:</span>
                  <span className="font-medium text-foreground">1u : {data.profile.correctionFactor || 50} mg/dL</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Target Glucose:</span>
                  <span className="font-medium text-foreground">{data.profile.targetGlucose || 120} mg/dL</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
