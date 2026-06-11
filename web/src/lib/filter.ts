"use client";

import { useMemo } from "react";

import { useStore } from "./store";
import type { SecurityEvent } from "./types";
import { daysUntil } from "./utils";

export interface Filters {
  country: string | null;
  city: string | null;
  types: string[];
  maxDeadlineDays: number | null;
  securityOnly: boolean;
  query: string;
}

export function applyFilters(
  events: SecurityEvent[],
  f: Filters,
): SecurityEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (f.country && e.country !== f.country) return false;
    if (f.city && e.city !== f.city) return false;
    if (f.types.length && !f.types.includes(e.eventType)) return false;
    if (f.securityOnly && !e.dedicatedSecurity) return false;
    if (f.maxDeadlineDays != null) {
      const d = daysUntil(e.deadline);
      if (d == null || d > f.maxDeadlineDays) return false;
    }
    if (q) {
      const hay = `${e.name} ${e.city ?? ""} ${e.description} ${e.topics.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function useFilteredEvents(): SecurityEvent[] {
  const events = useStore((s) => s.events);
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);
  const types = useStore((s) => s.types);
  const maxDeadlineDays = useStore((s) => s.maxDeadlineDays);
  const securityOnly = useStore((s) => s.securityOnly);
  const query = useStore((s) => s.query);
  return useMemo(
    () =>
      applyFilters(events, {
        country,
        city,
        types,
        maxDeadlineDays,
        securityOnly,
        query,
      }),
    [events, country, city, types, maxDeadlineDays, securityOnly, query],
  );
}
