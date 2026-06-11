"use client";

import { AnimatePresence, motion } from "motion/react";

import { useFilteredEvents } from "@/lib/filter";
import { useStore } from "@/lib/store";
import { cn, formatCoord, TYPE_COLOR, tMinus } from "@/lib/utils";

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

export default function EventList() {
  const events = useFilteredEvents();
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const city = useStore((s) => s.city);
  const country = useStore((s) => s.country);

  const scope = (city ?? country ?? "GLOBAL").toUpperCase();

  return (
    <HudPanel
      title="Events"
      right={`${String(events.length).padStart(2, "0")} // ${scope}`}
      className="flex h-full w-full flex-col lg:h-auto lg:max-h-[82vh] lg:w-[23rem]"
    >
      <div className="scroll-thin flex-1 overflow-y-auto p-2">
        <AnimatePresence mode="popLayout">
          {events.map((e, i) => {
            const accent = TYPE_COLOR[e.eventType] ?? "#fbbf24";
            const sel = selectedId === e.id;
            return (
              <motion.button
                key={e.id}
                layout
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{
                  delay: Math.min(i * 0.03, 0.3),
                  type: "spring",
                  stiffness: 220,
                  damping: 26,
                }}
                onClick={() => select(e.id)}
                className={cn(
                  "mb-1.5 block w-full border-l-2 px-3 py-2 text-left transition-colors",
                  sel
                    ? "border-l-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-l-white/10 bg-white/[0.015] hover:border-l-[var(--accent)]/50 hover:bg-white/[0.05]",
                )}
              >
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em]">
                  <span style={{ color: accent }}>{TYPE_GLYPH[e.eventType] ?? "▸"}</span>
                  <span style={{ color: accent }}>{CODE[e.eventType] ?? "EVT"}</span>
                  <span className="text-white/30">//</span>
                  <span className="text-white/55">{(e.city ?? "—").toUpperCase()}</span>
                  <span className="ml-auto text-white/40">{tMinus(e.deadline)}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-mono text-[11px] uppercase leading-snug tracking-wide text-white/90">
                  {e.name}
                </div>
                <div className="mt-1 font-mono text-[9px] tracking-[0.12em] text-white/35">
                  {formatCoord(e.latitude, e.longitude)}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {events.length === 0 && (
          <div className="px-3 py-10 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
            No signal // adjust filters
          </div>
        )}
      </div>
    </HudPanel>
  );
}
