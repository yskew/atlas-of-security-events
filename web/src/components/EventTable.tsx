"use client";

import { useMemo, useState } from "react";

import { useFilteredEvents } from "@/lib/filter";
import { useStore } from "@/lib/store";
import { cn, daysUntil, tMinus, TYPE_COLOR } from "@/lib/utils";

import FilterToolbar from "./FilterToolbar";
import { HudPanel, TYPE_GLYPH } from "./Hud";

const CODE: Record<string, string> = {
  ctf: "CTF",
  cfp: "CFP",
  conference: "CONF",
  training: "TRNG",
  village: "VLG",
  bugbounty: "BUG",
  meetup: "MEET",
  workshop: "WKSP",
};

type SortKey = "deadline" | "name" | "type";

// Urgency colour for the countdown — the most "at a glance" signal.
function deadlineColor(days: number | null): string {
  if (days == null) return "text-white/40";
  if (days <= 7) return "text-[var(--hot)]";
  if (days <= 30) return "text-[var(--accent)]";
  return "text-white/60";
}

export default function EventTable() {
  const events = useFilteredEvents();
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);

  const [sortKey, setSortKey] = useState<SortKey>("deadline");
  const [asc, setAsc] = useState(true); // soonest deadline first by default

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...events].sort((a, b) => {
      if (sortKey === "name") return dir * a.name.localeCompare(b.name);
      if (sortKey === "type") return dir * a.eventType.localeCompare(b.eventType);
      const da = daysUntil(a.deadline) ?? Infinity;
      const db = daysUntil(b.deadline) ?? Infinity;
      return dir * (da - db);
    });
  }, [events, sortKey, asc]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(true);
    }
  };

  const Th = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <button
      onClick={() => toggleSort(k)}
      className={cn(
        "flex items-center gap-1 uppercase tracking-[0.14em] text-white/45 transition-colors hover:text-white/85",
        className,
      )}
    >
      {children}
      <span className="text-[var(--accent)]">{sortKey === k ? (asc ? "▲" : "▼") : ""}</span>
    </button>
  );

  return (
    <HudPanel className="flex h-full w-full flex-col">
      {/* nested filter toolbar — unified with the list */}
      <FilterToolbar />

      {/* sortable header */}
      <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-[var(--accent)]/15 px-3 py-2 text-[10px]">
        <Th k="type">Type</Th>
        <Th k="name">Event</Th>
        <Th k="deadline" className="justify-end">
          Deadline
        </Th>
      </div>

      {/* rows */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {sorted.map((e) => {
          const days = daysUntil(e.deadline);
          const accent = TYPE_COLOR[e.eventType] ?? "#fbbf24";
          const sel = selectedId === e.id;
          const loc = [e.city, e.country].filter(Boolean).join(", ");
          return (
            <button
              key={e.id}
              onClick={() => select(e.id)}
              className={cn(
                "grid w-full grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-white/5 px-3 py-2 text-left transition-colors",
                sel
                  ? "bg-[var(--accent)]/10"
                  : "hover:bg-white/[0.04]",
              )}
            >
              {/* type */}
              <span
                className="flex flex-col items-start text-[9px] tracking-[0.1em]"
                style={{ color: accent }}
              >
                <span className="text-[13px] leading-none">{TYPE_GLYPH[e.eventType] ?? "▸"}</span>
                <span className="mt-0.5">{CODE[e.eventType] ?? "EVT"}</span>
              </span>
              {/* event + location */}
              <span className="min-w-0">
                <span className="block truncate text-[11px] uppercase leading-tight tracking-wide text-white/90">
                  {e.name}
                </span>
                <span className="block truncate text-[9px] uppercase tracking-[0.1em] text-white/40">
                  {loc || "—"}
                </span>
              </span>
              {/* deadline */}
              <span className={cn("text-right text-[11px] tabular-nums", deadlineColor(days))}>
                {tMinus(e.deadline)}
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div className="px-3 py-12 text-center text-[10px] uppercase tracking-[0.2em] text-white/35">
            No signal // adjust filters
          </div>
        )}
      </div>
    </HudPanel>
  );
}
