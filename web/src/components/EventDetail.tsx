"use client";

import { AnimatePresence, motion } from "motion/react";

import { useStore } from "@/lib/store";
import { formatCoord, formatDate, TYPE_COLOR, TYPE_LABEL, tMinus } from "@/lib/utils";

import { HudLabel, HudPanel, TYPE_GLYPH } from "./Hud";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-t border-white/8 py-2">
      <HudLabel>{label}</HudLabel>
      <div className="mt-1 font-mono text-[12px] text-white/85">{value}</div>
    </div>
  );
}

export default function EventDetail() {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const events = useStore((s) => s.events);
  const ev = events.find((e) => e.id === selectedId) ?? null;

  return (
    <AnimatePresence>
      {ev && (
        <motion.div
          key={ev.id}
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 230, damping: 26 }}
          className="pointer-events-auto"
        >
          <HudPanel className="scroll-thin max-h-[72dvh] w-[calc(100vw-1rem)] overflow-y-auto p-5 lg:max-h-none lg:w-[27rem] lg:overflow-visible">
            <div className="flex items-start justify-between">
              <div
                className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em]"
                style={{ color: TYPE_COLOR[ev.eventType] ?? "#fbbf24" }}
              >
                <span>{TYPE_GLYPH[ev.eventType] ?? "▸"}</span>
                <span>
                  {(TYPE_LABEL[ev.eventType] ?? ev.eventType).toUpperCase()}
                  {ev.subtype ? ` · ${ev.subtype.toUpperCase()}` : ""}
                </span>
              </div>
              <button
                onClick={() => select(null)}
                className="font-mono text-[11px] text-white/40 hover:text-white/90"
                aria-label="Close"
              >
                [ X ]
              </button>
            </div>

            <h2 className="mt-3 font-mono text-base uppercase leading-tight tracking-wide text-white">
              {ev.name}
            </h2>

            <div className="mt-3">
              <Field
                label="Location"
                value={[ev.venue, ev.city, ev.country].filter(Boolean).join(" · ")}
              />
              <Field label="Coordinates" value={formatCoord(ev.latitude, ev.longitude)} />
              <Field
                label={ev.eventType === "cfp" ? "Submission Window" : "Event Window"}
                value={
                  <span>
                    <span style={{ color: "var(--accent)" }}>{tMinus(ev.deadline)}</span>
                    {ev.deadline ? `  ·  ${formatDate(ev.deadline)}` : ""}
                    {ev.eventStart ? `  ·  ${formatDate(ev.eventStart)}` : ""}
                  </span>
                }
              />
            </div>

            <p className="mt-3 border-t border-white/8 pt-3 font-mono text-[11px] leading-relaxed text-white/65">
              {ev.description}
            </p>

            {ev.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ev.topics.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    className="border border-[var(--accent)]/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/50"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <a
                href={ev.registrationUrl ?? ev.primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 border border-[var(--accent)]/70 bg-[var(--accent)]/15 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/25"
              >
                ▸ {ev.eventType === "cfp" ? "Submit" : "Access"}
              </a>
              <a
                href={ev.primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-white/15 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-white/70 transition-colors hover:bg-white/10"
              >
                ▸ Source
              </a>
            </div>
          </HudPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
