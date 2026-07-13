import { NextResponse } from "next/server";
import { runReminderPass, runLocationReminderPass } from "@/lib/line/reminders";
import { getMonitorSettings } from "@/lib/data/settings";
import { USE_SUPABASE } from "@/lib/supabase/server";
import { localHour } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // many projects × contacts

/**
 * Reminder cron. A scheduler pings this once an hour with `Authorization: Bearer $CRON_SECRET`; we only
 * do work when the current local hour matches the admin-configured send hour, so the delivery time is
 * DB-driven rather than baked into the schedule.
 *
 * On Vercel Hobby (daily cron only) point vercel.json at the hour you want and set `send_hour` to match.
 * For sub-daily control use an external hourly scheduler (e.g. Supabase pg_cron) — see docs/LINE_SETUP.md.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!USE_SUPABASE) {
    return NextResponse.json({ ok: true, skipped: "database not configured" });
  }

  const now = new Date();
  const cfg = await getMonitorSettings();
  const hour = localHour(now);
  if (hour !== cfg.sendHour) {
    return NextResponse.json({ ok: true, skipped: "outside send hour", localHour: hour, sendHour: cfg.sendHour });
  }

  const reminders = await runReminderPass(now, false);
  const locations = await runLocationReminderPass(now, false);
  const sum = (arr: { sent: number; failed: number; skipped: number }[]) => ({
    projects: arr.length,
    sent: arr.reduce((s, r) => s + r.sent, 0),
    failed: arr.reduce((s, r) => s + r.failed, 0),
    skipped: arr.reduce((s, r) => s + r.skipped, 0),
  });
  return NextResponse.json({ ok: true, at: now.toISOString(), reminders: sum(reminders), locations: sum(locations) });
}
