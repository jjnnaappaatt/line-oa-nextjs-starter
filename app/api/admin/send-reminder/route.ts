import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { USE_SUPABASE } from "@/lib/supabase/server";
import { sendProjectReminder, sendReminderToPending, type ReminderKind } from "@/lib/data/reminders-admin";

export const dynamic = "force-dynamic";

/**
 * Manually send a reminder now.
 *   { "kind": "submit" | "location", "projectId": 1 }  → one project
 *   { "kind": "submit" | "location" }                   → every pending project
 */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!USE_SUPABASE) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });
  let kind: ReminderKind = "submit";
  let projectId: number | undefined;
  try {
    const body = await req.json();
    kind = body?.kind === "location" ? "location" : "submit";
    projectId = body?.projectId != null ? Number(body.projectId) : undefined;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (projectId) {
    const r = await sendProjectReminder(projectId, kind);
    return NextResponse.json({ ok: r.ok, result: r });
  }
  const r = await sendReminderToPending(kind);
  return NextResponse.json({ ok: r.failed === 0, ...r });
}
