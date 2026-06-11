"use client";

import { create } from "zustand";

import type { SecurityEvent } from "./types";

export type Zoom = "globe" | "country" | "city";

interface State {
  events: SecurityEvent[];
  country: string | null;
  city: string | null;
  types: string[]; // empty = all
  maxDeadlineDays: number | null; // null = any
  securityOnly: boolean;
  query: string;
  selectedId: number | null;

  setEvents: (e: SecurityEvent[]) => void;
  selectCountry: (c: string | null) => void;
  selectCity: (c: string | null) => void;
  focusCity: (country: string | null, city: string | null) => void;
  toggleType: (t: string) => void;
  setDeadline: (d: number | null) => void;
  setSecurityOnly: (b: boolean) => void;
  setQuery: (q: string) => void;
  select: (id: number | null) => void;
  reset: () => void;
}

export const useStore = create<State>((set) => ({
  events: [],
  country: null,
  city: null,
  types: [],
  maxDeadlineDays: null,
  securityOnly: false,
  query: "",
  selectedId: null,

  setEvents: (events) => set({ events }),
  // Choosing a country resets the city; choosing "all" resets both.
  selectCountry: (country) => set({ country, city: null, selectedId: null }),
  selectCity: (city) => set({ city, selectedId: null }),
  // Select a city AND its country together (used when tapping a globe marker),
  // so the breadcrumb / filter rail stay consistent.
  focusCity: (country, city) => set({ country, city, selectedId: null }),
  toggleType: (t) =>
    set((s) => ({
      types: s.types.includes(t)
        ? s.types.filter((x) => x !== t)
        : [...s.types, t],
    })),
  setDeadline: (maxDeadlineDays) => set({ maxDeadlineDays }),
  setSecurityOnly: (securityOnly) => set({ securityOnly }),
  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),
  reset: () =>
    set({
      country: null,
      city: null,
      types: [],
      maxDeadlineDays: null,
      securityOnly: false,
      query: "",
      selectedId: null,
    }),
}));

export function zoomLevel(country: string | null, city: string | null): Zoom {
  if (city) return "city";
  if (country) return "country";
  return "globe";
}
