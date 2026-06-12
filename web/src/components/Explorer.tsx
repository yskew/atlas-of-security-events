"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";

import { useStore } from "@/lib/store";
import type { SecurityEvent } from "@/lib/types";

import EventDetail from "./EventDetail";
import EventTable from "./EventTable";
import MobileShell from "./MobileShell";
import StatsStrip from "./StatsStrip";

// WebGL globe is client-only (three.js can't render during SSR).
const Globe = dynamic(() => import("./Globe"), { ssr: false });

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
      {/* WebGL globe — full-screen backdrop (its own starfield + dark bg). All
          panels float over it, so the globe + stars show behind them. */}
      <Globe />

      {/* top vignette for legibility under the floating panels */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/40 to-transparent" />

      {/* ===== DESKTOP (lg+): floating dashboard panels ===== */}
      {/* title — top-left */}
      <div className="absolute left-3 top-3 z-10 hidden lg:block">
        <div className="flex items-center gap-2.5 border border-[var(--accent)]/15 bg-[rgba(8,6,3,0.72)] px-4 py-2.5 font-mono backdrop-blur-md">
          <span className="h-7 w-[3px] bg-[var(--accent)]" />
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-white">
              Global Security Events
            </div>
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.26em] text-[var(--accent)]/90">
              CTF · CFP · CONF
            </div>
          </div>
        </div>
      </div>

      {/* right column: metrics stacked directly above the events list, the same
          width — visually unified, globe showing behind */}
      <div className="absolute bottom-3 right-3 top-3 z-10 hidden w-[30%] min-w-[22rem] flex-col gap-2.5 lg:flex">
        <div className="shrink-0">
          <StatsStrip />
        </div>
        <div className="min-h-0 flex-1">
          <EventTable />
        </div>
      </div>

      {/* attribution — bottom-left over the globe */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden font-mono text-[9px] uppercase tracking-[0.18em] text-white/35 lg:block">
        © 2026{" "}
        <a
          href="https://yskew.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto text-[var(--accent)]/80 transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Yskew
        </a>
        <span className="text-white/20"> · </span>Open source
      </div>

      {/* ===== MOBILE (<lg): unchanged — full-screen globe + top bar + sheets ===== */}
      <header className="absolute inset-x-0 top-0 z-10 border-b border-[var(--accent)]/20 bg-[rgba(8,6,3,0.82)] pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <span className="h-5 w-[3px] shrink-0 bg-[var(--accent)]" />
          <h1 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold uppercase tracking-[0.18em] text-white">
            Global Security Events
          </h1>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]" />
        </div>
      </header>

      {/* selected event detail — centered modal on desktop, bottom sheet on mobile */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(72px_+_env(safe-area-inset-bottom))] z-50 flex justify-center px-2 lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:z-50 lg:block lg:-translate-x-1/2 lg:-translate-y-1/2 lg:px-0">
        <EventDetail />
      </div>

      {/* mobile-only command bar + sheets (<lg) */}
      <MobileShell />
    </main>
  );
}
