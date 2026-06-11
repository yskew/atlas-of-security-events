"use client";

import { motion } from "motion/react";
import { useMemo } from "react";

import { citiesIn, countriesIn } from "@/lib/geo";
import { useStore } from "@/lib/store";
import { cn, TYPE_LABEL } from "@/lib/utils";

import { HudLabel, HudPanel } from "./Hud";

function Chip({
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
        "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
          : "border-white/12 text-white/55 hover:border-[var(--accent)]/40 hover:text-white/90",
      )}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <HudLabel>{label}</HudLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function FilterRail() {
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

  const countriesPresent = useMemo(() => countriesIn(events), [events]);
  const citiesPresent = useMemo(
    () => (country ? citiesIn(events, country) : []),
    [events, country],
  );
  const typesPresent = useMemo(() => [...new Set(events.map((e) => e.eventType))], [events]);

  return (
    <HudPanel
      title="Query"
      right="// FILTER"
      className="scroll-thin flex max-h-[80dvh] w-full flex-col gap-5 overflow-y-auto p-4 lg:max-h-[80vh] lg:w-72"
    >
      {/* search */}
      <div className="flex items-center gap-2 border border-white/12 bg-black/30 px-2.5 py-2">
        <span className="font-mono text-[12px] text-[var(--accent)]">{">"}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SEARCH..."
          className="w-full bg-transparent font-mono text-[11px] uppercase tracking-wider text-white/90 placeholder:text-white/25 outline-none"
        />
      </div>

      <Section label="Region">
        <Chip active={!country} onClick={() => selectCountry(null)}>
          ◍ All
        </Chip>
        {countriesPresent.map((c) => (
          <Chip key={c} active={country === c} onClick={() => selectCountry(c)}>
            {c}
          </Chip>
        ))}
      </Section>

      {country && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
          <Section label={`City // ${country}`}>
            <Chip active={!city} onClick={() => selectCity(null)}>
              All
            </Chip>
            {citiesPresent.map((c) => (
              <Chip key={c} active={city === c} onClick={() => selectCity(c)}>
                {c}
              </Chip>
            ))}
          </Section>
        </motion.div>
      )}

      <Section label="Class">
        {typesPresent.map((t) => (
          <Chip key={t} active={types.includes(t)} onClick={() => toggleType(t)}>
            {TYPE_LABEL[t] ?? t}
          </Chip>
        ))}
      </Section>

      <div>
        <HudLabel>
          Window{"  "}
          <span className="text-[var(--accent)]">
            {maxDeadlineDays == null ? "ANY" : `≤ ${maxDeadlineDays}D`}
          </span>
        </HudLabel>
        <input
          type="range"
          className="range mt-2 w-full"
          min={7}
          max={365}
          step={1}
          value={maxDeadlineDays ?? 365}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDeadline(v >= 365 ? null : v);
          }}
        />
      </div>

      <button
        onClick={() => setSecurityOnly(!securityOnly)}
        className="flex items-center justify-between border border-white/12 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/60 transition-colors hover:border-[var(--accent)]/40"
      >
        <span>Dedicated Sec</span>
        <span className={securityOnly ? "text-[var(--accent)]" : "text-white/35"}>
          [ {securityOnly ? "ON" : "OFF"} ]
        </span>
      </button>
    </HudPanel>
  );
}
