import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { formatTime, formatDate } from "@/lib/utils";
import type { PatientSnapshot } from "@workspace/api-client-react";

export function ChartPanel({ data }: { data: PatientSnapshot }) {
  if (!data.glucoseReadings || data.glucoseReadings.length === 0) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-muted-foreground">
          No CGM data available to display.
        </CardContent>
      </Card>
    );
  }

  // Reverse readings to chronological order for the chart
  const chartData = [...data.glucoseReadings].reverse().map(r => ({
    ...r,
    timeLabel: formatTime(r.timestamp),
    dateLabel: formatDate(r.timestamp)
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      let colorClass = "text-success";
      if (val < 70) colorClass = "text-destructive";
      if (val > 180) colorClass = "text-warning";
      if (val > 250) colorClass = "text-destructive";

      return (
        <div className="bg-card border border-border p-3 rounded-xl shadow-xl">
          <p className="text-sm text-muted-foreground mb-1">{payload[0].payload.dateLabel} at {label}</p>
          <p className={`text-2xl font-display font-bold ${colorClass}`}>
            {val} <span className="text-sm font-normal text-muted-foreground">mg/dL</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Continuous Glucose History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160 84% 39%)" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="hsl(160 84% 39%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 25% 27%)" vertical={false} />
                <XAxis 
                  dataKey="timeLabel" 
                  stroke="hsl(215 16% 65%)" 
                  fontSize={12} 
                  tickMargin={10}
                  minTickGap={50}
                />
                <YAxis 
                  stroke="hsl(215 16% 65%)" 
                  fontSize={12} 
                  tickMargin={10}
                  domain={[0, Math.max(300, Math.max(...chartData.map(d => d.value)) + 20)]}
                />
                <Tooltip content={<CustomTooltip />} />
                
                {/* Safe Range Area */}
                <ReferenceLine y={180} stroke="hsl(160 84% 39%)" strokeOpacity={0.5} strokeDasharray="3 3" />
                <ReferenceLine y={70} stroke="hsl(160 84% 39%)" strokeOpacity={0.5} strokeDasharray="3 3" />
                
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="hsl(217 91% 60%)" 
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 6, fill: "hsl(217 91% 60%)", stroke: "hsl(222 47% 11%)", strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
