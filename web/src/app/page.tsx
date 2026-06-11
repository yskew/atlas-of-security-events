import Explorer from "@/components/Explorer";
import { getActiveEvents } from "@/lib/db";
import type { SecurityEvent } from "@/lib/types";

// Always read fresh from Neon (the pipeline updates it daily).
export const dynamic = "force-dynamic";

export default async function Page() {
  let events: SecurityEvent[] = [];
  try {
    events = await getActiveEvents();
  } catch {
    events = [];
  }
  return <Explorer initial={events} />;
}
