"use client";

import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useRef } from "react";

import { useStore } from "@/lib/store";
import type { SecurityEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

import EventDetail from "./EventDetail";
import EventList from "./EventList";
import FilterRail from "./FilterRail";
import { HudPanel } from "./Hud";
import MobileShell from "./MobileShell";
import StatsStrip from "./StatsStrip";

// WebGL globe is client-only (three.js can't render during SSR).
const Globe = dynamic(() => import("./Globe"), { ssr: false });

function Breadcrumb() {
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);
  const selectCountry = useStore((s) => s.selectCountry);
  const selectCity = useStore((s) => s.selectCity);

  const Step = ({
    active,
    onClick,
    children,
  }: {
    active?: boolean;
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "transition-colors",
        active ? "text-[var(--accent)]" : "text-white/45 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="pointer-events-auto flex items-center gap-2 border border-[var(--accent)]/20 bg-[rgba(8,6,3,0.72)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] backdrop-blur-md">
      <span className="text-white/35">SCOPE //</span>
      <Step active={!country} onClick={() => selectCountry(null)}>
        Globe
      </Step>
      {country && (
        <>
          <span className="text-[var(--accent)]/50">›</span>
          <Step active={!city} onClick={() => selectCity(null)}>
            {country}
          </Step>
        </>
      )}
      {city && (
        <>
          <span className="text-[var(--accent)]/50">›</span>
          <Step active>{city}</Step>
        </>
      )}
    </div>
  );
}

export default function Explorer({ initial }: { initial: SecurityEvent[] }) {
  // Hydrate the store synchronously on first render (before children mount) so
  // the globe is created with its markers already present — no async gap.
  const hydrated = useRef(false);
  if (!hydrated.current) {
    useStore.setState({ events: initial });
    hydrated.current = true;
  }

  return (
    <main className="fixed inset-0 overflow-hidden">
      {/* WebGL globe backdrop (own starfield + dark bg) */}
      <Globe />

      {/* top vignette for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/40 to-transparent" />

      {/* header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-none absolute left-6 top-6 z-10"
      >
        <HudPanel className="px-3 py-2.5 lg:px-4 lg:py-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] shadow-[0_0_10px_2px_rgba(251,191,36,0.85)]" />
            <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-white lg:text-base">
              Atlas Eventuum Securitatis
            </h1>
          </div>
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
            CTF · CFP · CONF
          </p>
        </HudPanel>
      </motion.header>

      {/* breadcrumb top-center (desktop only — scope shows in the mobile bar) */}
      <div className="absolute left-1/2 top-6 z-10 hidden -translate-x-1/2 lg:block">
        <Breadcrumb />
      </div>

      {/* left: filters (desktop only — mobile uses the filter sheet) */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
        className="absolute left-6 top-28 z-10 hidden lg:block"
      >
        <FilterRail />
      </motion.div>

      {/* right: event list (desktop only — mobile uses the events sheet) */}
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 }}
        className="absolute right-6 top-12 z-10 hidden lg:block"
      >
        <EventList />
      </motion.div>

      {/* bottom-center: stats (desktop only — mobile condenses into the bar) */}
      <div className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 lg:block">
        <StatsStrip />
      </div>

      {/* selected event detail — centered modal on desktop, bottom sheet on mobile */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(72px_+_env(safe-area-inset-bottom))] z-50 flex justify-center px-2 lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:z-20 lg:block lg:-translate-x-1/2 lg:-translate-y-1/2 lg:px-0">
        <EventDetail />
      </div>

      {/* bottom-right: attribution (desktop — mobile bottom holds the command bar) */}
      <div className="pointer-events-none absolute bottom-6 right-6 z-10 hidden font-mono text-[9px] uppercase tracking-[0.18em] text-white/35 lg:block">
        © 2026 <span className="text-[var(--accent)]/80">Yskew</span>
        <span className="text-white/20"> · </span>Open source
      </div>

      {/* mobile-only command bar + sheets (<lg) */}
      <MobileShell />
    </main>
  );
}
