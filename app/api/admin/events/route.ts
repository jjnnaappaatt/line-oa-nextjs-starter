import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { USE_SUPABASE } from "@/lib/supabase/server";
import { getEvents, getEventRsvps, createEvent, cancelEvent, sendEvent } from "@/lib/data/events";

export const dynamic = "force-dynamic";

/** GET → list events (or `?rsvps=<id>` for one event's RSVP list). */
export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!USE_SUPABASE) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });
  const rsvpId = new URL(req.url).searchParams.get("rsvps");
  if (rsvpId) return NextResponse.json({ ok: true, rsvps: await getEventRsvps(Number(rsvpId)) });
  return NextResponse.json({ ok: true, events: await getEvents() });
}

/** POST → { action: "create" | "send" | "cancel", ... }. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!USE_SUPABASE) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  if (action === "create") {
    return NextResponse.json(await createEvent({
      title: String(body.title ?? ""),
      hostRegion: String(body.hostRegion ?? ""),
      targetRegions: Array.isArray(body.targetRegions) ? (body.targetRegions as string[]) : [],
      venue: String(body.venue ?? ""),
      when: String(body.when ?? ""),
      details: String(body.details ?? ""),
      imageUrl: (body.imageUrl as string) ?? null,
    }));
  }
  if (action === "send") return NextResponse.json(await sendEvent(Number(body.id)));
  if (action === "cancel") return NextResponse.json(await cancelEvent(Number(body.id)));
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
