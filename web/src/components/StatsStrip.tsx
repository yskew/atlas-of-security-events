"use client";

import { motion } from "motion/react";
import { useMemo } from "react";

import { useFilteredEvents } from "@/lib/filter";
import { cityCoord, countryCentroid } from "@/lib/geo";
import { useStore } from "@/lib/store";
import { daysUntil, formatCoord } from "@/lib/utils";

import { HudPanel } from "./Hud";

function Readout({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div className="px-4 text-center">
      <div className="font-mono text-lg tabular-nums" style={{ color: accent ?? "#f4ece0" }}>
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">{label}</div>
    </div>
  );
}

export default function StatsStrip() {
  const events = useFilteredEvents();
  const allEvents = useStore((s) => s.events);
  const city = useStore((s) => s.city);
  const country = useStore((s) => s.country);

  const stats = useMemo(() => {
    const cfpSoon = events.filter(
      (e) => e.eventType === "cfp" && (daysUntil(e.deadline) ?? 999) <= 30,
    ).length;
    const cities = new Set(events.map((e) => e.city).filter(Boolean)).size;
    const ctfs = events.filter((e) => e.eventType === "ctf").length;
    return { total: events.length, cfpSoon, cities, ctfs };
  }, [events]);

  const loc = city
    ? cityCoord(allEvents, city)
    : country
      ? countryCentroid(allEvents, country)
      : null;
  const scope = (city ?? country ?? "GLOBAL").toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="w-full"
    >
      <HudPanel className="flex w-full items-center justify-center gap-1 px-3 py-2">
        <div className="px-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">
            Status
          </div>
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--accent)]">
            ▸ Tracking // {scope}
          </div>
        </div>
        <div className="mx-1 h-8 w-px bg-white/10" />
        <Readout value={String(stats.total).padStart(2, "0")} label="Events" accent="#fbbf24" />
        <Readout value={String(stats.cfpSoon).padStart(2, "0")} label="CFP≤30D" accent="#fb923c" />
        <Readout value={String(stats.ctfs).padStart(2, "0")} label="CTF" accent="#fcd34d" />
        <Readout value={String(stats.cities).padStart(2, "0")} label="Cities" />
        <div className="mx-1 h-8 w-px bg-white/10" />
        <div className="px-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">Coord</div>
          <div className="font-mono text-[12px] tabular-nums text-white/80">
            {formatCoord(loc?.[0] ?? null, loc?.[1] ?? null)}
          </div>
        </div>
      </HudPanel>
    </motion.div>
  );
}
