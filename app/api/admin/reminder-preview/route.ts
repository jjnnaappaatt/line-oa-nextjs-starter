import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { USE_SUPABASE } from "@/lib/supabase/server";
import { runReminderPass, runLocationReminderPass } from "@/lib/line/reminders";

export const dynamic = "force-dynamic";

/**
 * Dry-run of both reminder passes — shows exactly WHO would be reminded right now WITHOUT sending or
 * logging anything. Ungated by the send-hour gate on purpose (that gate is only in the cron route).
 */
export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!USE_SUPABASE) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });
  const now = new Date();
  const [reminders, locations] = await Promise.all([
    runReminderPass(now, true),
    runLocationReminderPass(now, true),
  ]);
  return NextResponse.json({ ok: true, reminders, locations });
}
