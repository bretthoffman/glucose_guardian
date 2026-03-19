import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, formatDate } from "@/lib/utils";
import type { PatientSnapshot } from "@workspace/api-client-react";
import { Syringe } from "lucide-react";

export function InsulinPanel({ data }: { data: PatientSnapshot }) {
  const logs = data.insulinLog || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Syringe className="w-5 h-5 text-primary" />
          Insulin Delivery Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 rounded-t-lg">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Date & Time</th>
                  <th className="px-4 py-3">Units</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 rounded-tr-lg">Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-foreground">{formatDate(log.timestamp)}</div>
                      <div className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-lg font-bold text-primary">{log.units}</span>
                      <span className="text-muted-foreground ml-1">u</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium border border-border">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {log.note || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
            No insulin logs recorded yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
