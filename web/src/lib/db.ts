import { neon } from "@neondatabase/serverless";

import type { SecurityEvent } from "./types";

// Neon returns date/timestamp columns as JS Date objects; through the RSC
// (server-component) path they'd reach the client as Dates and crash React
// ("Objects are not valid as a React child"). Always emit plain strings.
function asDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Reads the same Neon DB the Python pipeline writes to (read-only here).
export async function getActiveEvents(): Promise<SecurityEvent[]> {
  const url = process.env.DATABASE_URL;
  if (!url) return [];
  const sql = neon(url);
  const rows = (await sql`
    SELECT id, name, event_type, subtype, country, city, latitude, longitude,
           venue, is_online, dedicated_security, audience, event_start, event_end,
           cfp_closes, deadline, description, topics, primary_url, registration_url
    FROM events
    WHERE status = 'active'
    ORDER BY deadline ASC NULLS LAST
  `) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ""),
    eventType: String(r.event_type ?? "conference") as SecurityEvent["eventType"],
    subtype: (r.subtype as string) ?? null,
    country: (r.country as string) ?? null,
    city: (r.city as string) ?? null,
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    venue: (r.venue as string) ?? null,
    isOnline: Boolean(r.is_online),
    dedicatedSecurity: Boolean(r.dedicated_security),
    audience: (r.audience as string) ?? null,
    eventStart: asDateStr(r.event_start),
    eventEnd: asDateStr(r.event_end),
    cfpCloses: asDateStr(r.cfp_closes),
    deadline: asDateStr(r.deadline),
    description: String(r.description ?? ""),
    topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
    primaryUrl: String(r.primary_url ?? ""),
    registrationUrl: (r.registration_url as string) ?? null,
  }));
}
