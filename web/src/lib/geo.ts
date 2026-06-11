// All geography is derived from the event data — adding a city/country in the
// backend (which stamps lat/lng onto events) needs ZERO frontend changes.

import type { SecurityEvent } from "./types";

export type LatLng = [number, number];

export function hasCoords(e: SecurityEvent): boolean {
  return e.latitude != null && e.longitude != null;
}

/** Distinct countries present in the data, alphabetical. */
export function countriesIn(events: SecurityEvent[]): string[] {
  return [...new Set(events.map((e) => e.country).filter(Boolean))].sort() as string[];
}

/** Distinct cities present for a country (or all), alphabetical. */
export function citiesIn(events: SecurityEvent[], country: string | null): string[] {
  return [
    ...new Set(
      events
        .filter((e) => (country ? e.country === country : true))
        .map((e) => e.city)
        .filter(Boolean),
    ),
  ].sort() as string[];
}

/** The coordinate of a city, taken from the first event that has it. */
export function cityCoord(events: SecurityEvent[], city: string): LatLng | null {
  const e = events.find((x) => x.city === city && hasCoords(x));
  return e ? [e.latitude as number, e.longitude as number] : null;
}

/** Centroid of a country = mean of its distinct cities' coordinates. */
export function countryCentroid(
  events: SecurityEvent[],
  country: string,
): LatLng | null {
  const byCity = new Map<string, LatLng>();
  for (const e of events) {
    if (e.country === country && e.city && hasCoords(e)) {
      byCity.set(e.city, [e.latitude as number, e.longitude as number]);
    }
  }
  const pts = [...byCity.values()];
  if (!pts.length) return null;
  const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const lng = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return [lat, lng];
}

/** One marker per city with coords, sized by event count. */
export function cityMarkers(
  events: SecurityEvent[],
): { location: LatLng; size: number }[] {
  const agg = new Map<string, { loc: LatLng; n: number }>();
  for (const e of events) {
    if (e.city && hasCoords(e)) {
      const cur = agg.get(e.city);
      if (cur) cur.n += 1;
      else agg.set(e.city, { loc: [e.latitude as number, e.longitude as number], n: 1 });
    }
  }
  return [...agg.values()].map(({ loc, n }) => ({
    location: loc,
    size: Math.min(0.06 + n * 0.015, 0.12),
  }));
}
