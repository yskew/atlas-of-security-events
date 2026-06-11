import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  // Neon returns dates as full ISO timestamps (e.g. 2026-06-15T23:00:00.000Z);
  // new Date() handles both that and a plain YYYY-MM-DD.
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** HUD-style coordinate readout, e.g. "12.97°N  77.59°E". */
export function formatCoord(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return "--.--°  ---.--°";
  const ns = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
  return `${ns}  ${ew}`;
}

/** T-minus countdown, e.g. "T-09D", "T-00D", "ELAPSED". */
export function tMinus(dateStr: string | null): string {
  const n = daysUntil(dateStr);
  if (n == null) return "T-- -";
  if (n < 0) return "ELAPSED";
  return `T-${String(n).padStart(2, "0")}D`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDeadline(dateStr: string | null): string {
  const n = daysUntil(dateStr);
  if (n === null) return "TBD";
  if (n < 0) return "closed";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 30) return `in ${n} days`;
  if (n < 60) return "in ~1 month";
  return `in ${Math.round(n / 30)} months`;
}

export const TYPE_LABEL: Record<string, string> = {
  ctf: "CTF",
  cfp: "Call for Papers",
  conference: "Conference",
  training: "Training",
  village: "Village",
  bugbounty: "Bug Bounty",
  meetup: "Meetup",
  workshop: "Workshop",
};

// Warm gold/amber palette to match the molten-globe theme.
export const TYPE_COLOR: Record<string, string> = {
  ctf: "#fcd34d", // gold
  cfp: "#fb923c", // orange
  conference: "#f59e0b", // amber
  training: "#fbbf24",
  village: "#fda4af", // warm rose
  bugbounty: "#f87171", // red
  meetup: "#fdba74", // light orange
  workshop: "#fde047", // yellow
};
