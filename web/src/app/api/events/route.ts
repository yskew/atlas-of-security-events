import { NextResponse } from "next/server";

import { getActiveEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await getActiveEvents();
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { events: [], error: (err as Error).message },
      { status: 500 },
    );
  }
}
