import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getGlucoseColor(value: number) {
  if (value < 55) return "text-destructive border-destructive/30 bg-destructive/10";
  if (value < 70) return "text-orange-500 border-orange-500/30 bg-orange-500/10";
  if (value <= 180) return "text-success border-success/30 bg-success/10";
  if (value <= 250) return "text-warning border-warning/30 bg-warning/10";
  return "text-destructive border-destructive/30 bg-destructive/10";
}

export function getGlucoseHex(value: number) {
  if (value < 55) return "#EF4444";
  if (value < 70) return "#F97316";
  if (value <= 180) return "#10B981";
  if (value <= 250) return "#F59E0B";
  return "#EF4444";
}

export function formatTime(isoString: string) {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(isoString: string) {
  return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function calculateA1C(readings: { value: number }[]) {
  if (!readings || readings.length === 0) return null;
  const avg = readings.reduce((sum, r) => sum + r.value, 0) / readings.length;
  return ((avg + 46.7) / 28.7).toFixed(1);
}

export function calculateTIR(readings: { value: number }[]) {
  if (!readings || readings.length === 0) return 0;
  const inRange = readings.filter(r => r.value >= 70 && r.value <= 180).length;
  return Math.round((inRange / readings.length) * 100);
}
