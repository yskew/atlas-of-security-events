"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { citiesIn, countriesIn } from "@/lib/geo";
import { useStore } from "@/lib/store";
import { cn, TYPE_LABEL } from "@/lib/utils";

type Panel = "country" | "city" | "type" | "when" | null;

function Caret({ open }: { open: boolean }) {
  return (
    <span className={cn("text-[var(--accent)]/70 transition-transform", open && "rotate-180")}>
      ▾
    </span>
  );
}

function Trigger({
  active,
  open,
  onClick,
  children,
}: {
  active?: boolean;
  open?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
          : open
            ? "border-[var(--accent)]/50 text-white/90"
            : "border-white/12 text-white/55 hover:border-[var(--accent)]/40 hover:text-white/85",
      )}
    >
      {children}
    </button>
  );
}

// Popover anchors to the trigger's RIGHT edge and grows left/down, so it stays
// inside the screen even though this lives in the right-most column.
function Popover({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "scroll-thin absolute right-0 top-[calc(100%+5px)] z-50 max-h-64 overflow-y-auto border border-[var(--accent)]/25 bg-[rgba(10,7,3,0.97)] p-2 shadow-[0_12px_34px_rgba(0,0,0,0.6)] backdrop-blur-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

function OptChip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border px-2 py-1 text-[10px] uppercase tracking-[0.1em] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
          : "border-white/12 text-white/60 hover:border-[var(--accent)]/40 hover:text-white/90",
      )}
    >
      {children}
    </button>
  );
}

export default function FilterToolbar() {
  const events = useStore((s) => s.events);
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);
  const types = useStore((s) => s.types);
  const maxDeadlineDays = useStore((s) => s.maxDeadlineDays);
  const securityOnly = useStore((s) => s.securityOnly);
  const query = useStore((s) => s.query);

  const selectCountry = useStore((s) => s.selectCountry);
  const selectCity = useStore((s) => s.selectCity);
  const toggleType = useStore((s) => s.toggleType);
  const setDeadline = useStore((s) => s.setDeadline);
  const setSecurityOnly = useStore((s) => s.setSecurityOnly);
  const setQuery = useStore((s) => s.setQuery);
  const reset = useStore((s) => s.reset);

  const [open, setOpen] = useState<Panel>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const countriesPresent = useMemo(() => countriesIn(events), [events]);
  const citiesPresent = useMemo(
    () => (country ? citiesIn(events, country) : []),
    [events, country],
  );
  const typesPresent = useMemo(() => [...new Set(events.map((e) => e.eventType))], [events]);

  // Close the open popover on outside-click or Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const anyActive =
    !!country ||
    !!city ||
    types.length > 0 ||
    maxDeadlineDays != null ||
    securityOnly ||
    query.trim() !== "";
  const windowLabel = maxDeadlineDays == null ? "Any" : `≤${maxDeadlineDays}d`;
  const toggle = (p: Panel) => setOpen((cur) => (cur === p ? null : p));

  return (
    <div
      ref={rootRef}
      className="flex flex-wrap items-center gap-1.5 border-b border-[var(--accent)]/15 px-3 py-2"
    >
      {/* persistent search */}
      <div className="flex w-32 shrink-0 items-center gap-1.5 border border-white/12 bg-black/30 px-2 py-1">
        <span className="text-[11px] text-[var(--accent)]">{">"}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SEARCH..."
          className="w-full min-w-0 bg-transparent text-[10px] uppercase tracking-wider text-white/90 placeholder:text-white/25 outline-none"
        />
      </div>

      {/* country */}
      <div className="relative shrink-0">
        <Trigger active={!!country} open={open === "country"} onClick={() => toggle("country")}>
          {country ?? "Country"} <Caret open={open === "country"} />
        </Trigger>
        {open === "country" && (
          <Popover className="w-56">
            <div className="flex flex-wrap gap-1.5">
              <OptChip active={!country} onClick={() => { selectCountry(null); setOpen(null); }}>
                ◍ All
              </OptChip>
              {countriesPresent.map((c) => (
                <OptChip key={c} active={country === c} onClick={() => { selectCountry(c); setOpen(null); }}>
                  {c}
                </OptChip>
              ))}
            </div>
          </Popover>
        )}
      </div>

      {/* city — only once a country is chosen */}
      {country && citiesPresent.length > 0 && (
        <div className="relative shrink-0">
          <Trigger active={!!city} open={open === "city"} onClick={() => toggle("city")}>
            {city ?? "City"} <Caret open={open === "city"} />
          </Trigger>
          {open === "city" && (
            <Popover className="w-56">
              <div className="flex flex-wrap gap-1.5">
                <OptChip active={!city} onClick={() => { selectCity(null); setOpen(null); }}>
                  All
                </OptChip>
                {citiesPresent.map((c) => (
                  <OptChip key={c} active={city === c} onClick={() => { selectCity(c); setOpen(null); }}>
                    {c}
                  </OptChip>
                ))}
              </div>
            </Popover>
          )}
        </div>
      )}

      {/* type — multi-select, stays open */}
      <div className="relative shrink-0">
        <Trigger active={types.length > 0} open={open === "type"} onClick={() => toggle("type")}>
          Type{types.length > 0 ? ` · ${types.length}` : ""} <Caret open={open === "type"} />
        </Trigger>
        {open === "type" && (
          <Popover className="w-48">
            <div className="flex flex-wrap gap-1.5">
              {typesPresent.map((t) => (
                <OptChip key={t} active={types.includes(t)} onClick={() => toggleType(t)}>
                  {TYPE_LABEL[t] ?? t}
                </OptChip>
              ))}
            </div>
          </Popover>
        )}
      </div>

      {/* deadline window */}
      <div className="relative shrink-0">
        <Trigger active={maxDeadlineDays != null} open={open === "when"} onClick={() => toggle("when")}>
          {windowLabel} <Caret open={open === "when"} />
        </Trigger>
        {open === "when" && (
          <Popover className="w-52">
            <div className="mb-2 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-white/40">
              <span>Deadline window</span>
              <span className="text-[var(--accent)]">{windowLabel}</span>
            </div>
            <input
              type="range"
              className="range w-full"
              min={7}
              max={365}
              step={1}
              value={maxDeadlineDays ?? 365}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDeadline(v >= 365 ? null : v);
              }}
            />
          </Popover>
        )}
      </div>

      {/* dedicated-security — direct toggle */}
      <button
        onClick={() => setSecurityOnly(!securityOnly)}
        className={cn(
          "shrink-0 border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
          securityOnly
            ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
            : "border-white/12 text-white/55 hover:border-[var(--accent)]/40 hover:text-white/85",
        )}
      >
        Sec
      </button>

      {/* clear — only when something is active */}
      {anyActive && (
        <button
          onClick={() => { reset(); setOpen(null); }}
          aria-label="Clear filters"
          className="shrink-0 border border-white/12 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/45 transition-colors hover:border-[var(--hot)]/50 hover:text-[var(--hot)]"
        >
          ✕
        </button>
      )}
    </div>
  );
}
