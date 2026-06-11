"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { useFilteredEvents } from "@/lib/filter";
import { useStore } from "@/lib/store";
import { daysUntil } from "@/lib/utils";

import EventList from "./EventList";
import FilterRail from "./FilterRail";

/** Mobile-only chrome (<lg): a bottom command bar that opens a SINGLE sheet
 * combining the filters (collapsible, on top) and the live events list below —
 * filter and see results update in the same view. Reuses the existing
 * FilterRail / EventList so the desktop layout stays byte-for-byte identical. */
export default function MobileShell() {
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const events = useFilteredEvents();
  const selectedId = useStore((s) => s.selectedId);
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);
  const types = useStore((s) => s.types);
  const query = useStore((s) => s.query);
  const maxDeadlineDays = useStore((s) => s.maxDeadlineDays);
  const securityOnly = useStore((s) => s.securityOnly);

  const scope = (city ?? country ?? "GLOBAL").toUpperCase();
  const cfpSoon = events.filter(
    (e) => e.eventType === "cfp" && (daysUntil(e.deadline) ?? 999) <= 30,
  ).length;
  const ctfs = events.filter((e) => e.eventType === "ctf").length;

  // How many filters are narrowing the list (for the collapsed header badge).
  const activeFilters = [
    country,
    city,
    query.trim(),
    maxDeadlineDays != null,
    securityOnly,
    types.length > 0,
  ].filter(Boolean).length;

  // Selecting an event opens the detail sheet — close this one so the detail
  // shows over the globe rather than stacking on top of the list.
  useEffect(() => {
    if (selectedId) setOpen(false);
  }, [selectedId]);

  const openSheet = () => {
    setFiltersOpen(false); // always start with the list visible
    setOpen(true);
  };
  const close = () => setOpen(false);

  return (
    <div className="lg:hidden">
      {/* dim backdrop behind the open sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* the one merged sheet: collapsible filters on top, live list below */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-x-2 bottom-2 z-40 flex h-[82dvh] flex-col pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHandle onClose={close} />

            {/* filter toggle (collapsed by default) */}
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="mb-2 flex items-center justify-between border border-[var(--accent)]/25 bg-[rgba(8,6,3,0.88)] px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] backdrop-blur-md transition-colors active:bg-[var(--accent)]/10"
            >
              <span className="text-white/75">
                ⚙ Filters
                {activeFilters > 0 && (
                  <span className="ml-2 text-[var(--accent)]">({activeFilters})</span>
                )}
              </span>
              <span className="text-[var(--accent)]">{filtersOpen ? "⌃" : "⌄"}</span>
            </button>

            {/* collapsible filter rail */}
            <AnimatePresence initial={false}>
              {filtersOpen && (
                <motion.div
                  key="filters"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                  className="mb-2 overflow-hidden"
                >
                  <div className="max-h-[46dvh] overflow-y-auto">
                    <FilterRail />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* live events list fills the rest */}
            <div className="min-h-0 flex-1">
              <EventList />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* persistent bottom bar — tap to open the merged sheet */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--accent)]/20 bg-[rgba(8,6,3,0.9)] backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={openSheet}
          className="flex w-full items-center gap-3 px-4 py-3 text-left font-mono"
          aria-label="Browse events"
        >
          <span className="text-[12px] tracking-[0.14em] text-[var(--accent)]">
            {String(events.length).padStart(2, "0")} EVT
            <span className="text-white/25"> · </span>
            {String(cfpSoon).padStart(2, "0")} CFP
            <span className="text-white/25"> · </span>
            {String(ctfs).padStart(2, "0")} CTF
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-white/45">
            // {scope}
          </span>
          <span className="text-[var(--accent)]">▲</span>
        </button>
      </div>
    </div>
  );
}

function SheetHandle({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative flex h-10 items-center justify-center">
      {/* drag handle */}
      <span className="h-1 w-10 rounded-full bg-white/30" />
      {/* close — square HUD button, comfortable touch target */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center border border-[var(--accent)]/30 bg-[rgba(8,6,3,0.92)] text-base leading-none text-white/70 backdrop-blur-md transition-colors active:border-[var(--accent)] active:bg-[var(--accent)]/15 active:text-[var(--accent)]"
      >
        ✕
      </button>
    </div>
  );
}
