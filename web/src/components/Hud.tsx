"use client";

import { cn } from "@/lib/utils";

// Geometric glyph per event type — gives the rows a tactical-readout feel.
export const TYPE_GLYPH: Record<string, string> = {
  ctf: "◇",
  cfp: "△",
  conference: "⬡",
  training: "▣",
  village: "◈",
  bugbounty: "⬢",
  meetup: "○",
  workshop: "▤",
};

/** Four corner brackets — the HUD frame accent. */
function Corners() {
  const base = "pointer-events-none absolute h-2.5 w-2.5 border-[var(--accent)]/70";
  return (
    <>
      <span className={cn(base, "left-0 top-0 border-l border-t")} />
      <span className={cn(base, "right-0 top-0 border-r border-t")} />
      <span className={cn(base, "bottom-0 left-0 border-b border-l")} />
      <span className={cn(base, "bottom-0 right-0 border-b border-r")} />
    </>
  );
}

/** A thin-bordered translucent panel with corner brackets + optional title bar. */
export function HudPanel({
  title,
  right,
  className,
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative border border-[var(--accent)]/15 bg-[rgba(8,6,3,0.72)] font-mono backdrop-blur-md",
        className,
      )}
    >
      <Corners />
      {title && (
        <div className="flex items-center justify-between border-b border-[var(--accent)]/15 px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            {title}
          </span>
          {right && (
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {right}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** Uppercase micro-label used above fields/sections. */
export function HudLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-white/35">
      {children}
    </div>
  );
}
