import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getMonitorSettings } from "@/lib/data/settings";
import { pushMessages } from "./push";
import { statusFlex } from "./flex";
import { LIFF } from "./liff";
import {
  asOfCivil, daysBetween, currentReportMonth, deadlineDate, deadlineLabel, monthLabel,
} from "@/lib/time";

/**
 * The scheduled reminder engine. Two passes, both idempotent via the `notifications` log:
 *   1. runReminderPass — monthly submission reminders with advance → due → overdue escalation.
 *   2. runLocationReminderPass — a "finish your one-time setup" nudge that repeats until done.
 *
 * A cron scheduler pings /api/cron/reminders hourly; that route only runs these passes when the local
 * hour equals the admin-configured `send_hour`, so delivery time is data-driven, not baked into the
 * schedule. All day math is in one fixed timezone (see lib/time.ts).
 */
type Db = ReturnType<typeof supabaseAdmin>;
type ReminderType = "advance" | "due" | "overdue" | "location";
export type PassSummary = { projectId: number; projectName: string; reminderType: ReminderType; sent: number; failed: number; skipped: number };

function nextReminderType(
  asOf: Date, deadline: Date, satisfied: Set<string>, lastOverdue: Date | null, advanceDays: number, overdueEveryDays: number,
): "advance" | "due" | "overdue" | null {
  const advanceOn = new Date(deadline); advanceOn.setUTCDate(advanceOn.getUTCDate() - advanceDays);
  if (asOf < advanceOn) return null;
  if (asOf < deadline) return satisfied.has("advance") ? null : "advance";
  const dueWindow = new Date(deadline); dueWindow.setUTCDate(dueWindow.getUTCDate() + overdueEveryDays);
  if (asOf < dueWindow) return satisfied.has("due") ? null : "due";
  if (!lastOverdue) return "overdue";
  // Space overdue re-sends civil-day↔civil-day (asOfCivil the last send too) so overdueEveryDays=1 is
  // truly daily under the send-hour gate — comparing a civil-midnight to the raw sent instant would
  // floor to 0 the next day (every-other-day). Same basis as the location nudge below.
  return daysBetween(asOf, asOfCivil(lastOverdue)) >= overdueEveryDays ? "overdue" : null;
}

function reminderFlex(type: ReminderType, projectName: string, mLabel: string, dLabel: string) {
  if (type === "location") {
    const altText = `Reminder: please complete the one-time setup for ${projectName}. Verify at ${LIFF("/status")}`;
    return statusFlex({
      tone: "warning", headline: "📍 Please finish project setup", title: projectName,
      rows: [["Status", "Setup not verified yet"]],
      button: { label: "Verify", uri: LIFF("/status") }, altText,
    });
  }
  const headline = type === "advance" ? "⏰ Monthly report due soon"
    : type === "due" ? "📌 Monthly report is due today"
      : "⚠️ Monthly report is overdue";
  const altText = `${headline} — ${projectName}. Report month ${mLabel}, due ${dLabel}. Submit at ${LIFF("/submit")}`;
  return statusFlex({
    tone: type === "overdue" ? "danger" : "warning", headline, title: projectName,
    rows: [["Report month", mLabel], ["Due", dLabel]],
    button: { label: "Submit", uri: LIFF("/submit") }, altText,
  });
}

/** Push one reminder type to every active contact of a project and log each attempt. */
async function dispatch(
  db: Db, project: { id: number; name: string }, reportMonth: string,
  type: ReminderType, mLabel: string, dLabel: string, dryRun: boolean,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const flex = reminderFlex(type, project.name, mLabel, dLabel);
  const { data: contacts } = await db.from("contacts")
    .select("display_name,line_user_id").eq("project_id", project.id).eq("active", true);
  const rows = (contacts ?? []) as { display_name: string | null; line_user_id: string | null }[];
  let sent = 0, failed = 0, skipped = 0;

  if (!rows.length) {
    skipped++;
    if (!dryRun) await db.from("notifications").insert({
      project_id: project.id, report_month: reportMonth, channel: "none", recipient: null,
      reminder_type: type, status: "skipped", error: "no registered contact", sent_at: new Date().toISOString(),
    });
    return { sent, failed, skipped };
  }
  for (const c of rows) {
    const now = new Date().toISOString();
    if (c.line_user_id) {
      let ok = true, err: string | null = null, msgId: string | null = null;
      if (!dryRun) { const r = await pushMessages(c.line_user_id, [flex]); ok = r.ok; err = r.error ?? null; msgId = r.messageId ?? null; }
      if (ok) sent++; else failed++;
      if (!dryRun) await db.from("notifications").insert({
        project_id: project.id, report_month: reportMonth, channel: "line", recipient: c.line_user_id,
        reminder_type: type, status: ok ? "sent" : "failed", error: err, provider_message_id: msgId, sent_at: now,
      });
    } else {
      skipped++;
      if (!dryRun) await db.from("notifications").insert({
        project_id: project.id, report_month: reportMonth, channel: "none", recipient: c.display_name || null,
        reminder_type: type, status: "skipped", error: "no line_user_id", sent_at: now,
      });
    }
  }
  return { sent, failed, skipped };
}

/** Monthly submission reminders (advance/due/overdue). Skips completed submissions; idempotent per month. */
export async function runReminderPass(asOf: Date = new Date(), dryRun = false): Promise<PassSummary[]> {
  const cfg = await getMonitorSettings();
  if (!cfg.notificationsEnabled) return [];
  const db = supabaseAdmin();
  const today = asOfCivil(asOf);
  const reportMonth = currentReportMonth(asOf);
  const deadline = deadlineDate(reportMonth, cfg.deadlineDay);
  const mLabel = monthLabel(reportMonth), dLabel = deadlineLabel(reportMonth, cfg.deadlineDay);

  const { data: projects } = await db.from("projects").select("id,name").eq("active", true);
  const out: PassSummary[] = [];
  for (const p of (projects ?? []) as { id: number; name: string }[]) {
    const { data: sub } = await db.from("submissions").select("status")
      .eq("project_id", p.id).eq("report_month", reportMonth).maybeSingle();
    if (sub?.status === "completed") continue;

    const { data: logs } = await db.from("notifications").select("reminder_type,status,sent_at")
      .eq("project_id", p.id).eq("report_month", reportMonth);
    const satisfied = new Set<string>(); const overdue: number[] = [];
    for (const l of (logs ?? []) as { reminder_type: string; status: string; sent_at: string | null }[]) {
      // Only a real delivery counts as "done": a `skipped` (no reachable contact) must not suppress the
      // reminder once the project gains a LINE contact mid-month, and only `sent` overdues space the next.
      if (l.status === "sent") satisfied.add(l.reminder_type);
      if (l.reminder_type === "overdue" && l.status === "sent" && l.sent_at) overdue.push(new Date(l.sent_at).getTime());
    }
    const lastOverdue = overdue.length ? new Date(Math.max(...overdue)) : null;
    const rtype = nextReminderType(today, deadline, satisfied, lastOverdue, cfg.advanceDays, cfg.overdueEveryDays);
    if (!rtype) continue;
    const r = await dispatch(db, p, reportMonth, rtype, mLabel, dLabel, dryRun);
    out.push({ projectId: p.id, projectName: p.name, reminderType: rtype, ...r });
  }
  return out;
}

/** "Finish your one-time setup" nudge — active projects with a null `verified_at`, repeated every
 *  `overdueEveryDays` days until verified; auto-stops once `verified_at` is set. */
export async function runLocationReminderPass(asOf: Date = new Date(), dryRun = false): Promise<PassSummary[]> {
  const cfg = await getMonitorSettings();
  if (!cfg.notificationsEnabled || !cfg.locationRemindersEnabled) return [];
  const db = supabaseAdmin();
  const today = asOfCivil(asOf); // civil-day midnight, for day-granular spacing
  const reportMonth = currentReportMonth(asOf);
  const mLabel = monthLabel(reportMonth), dLabel = deadlineLabel(reportMonth, cfg.deadlineDay);

  const { data: projects } = await db.from("projects")
    .select("id,name").eq("active", true).is("verified_at", null);
  const out: PassSummary[] = [];
  for (const p of (projects ?? []) as { id: number; name: string }[]) {
    // Repeat every `overdueEveryDays` days until verified. Anchored on ACTUAL delivery only (a `skipped`
    // — no reachable contact — must not suppress it once LINE is linked), compared civil-day↔civil-day
    // (asOfCivil on both sides) so overdueEveryDays=1 is truly daily under the send-hour gate.
    const { data: last } = await db.from("notifications").select("sent_at")
      .eq("project_id", p.id).eq("reminder_type", "location").eq("status", "sent")
      .order("sent_at", { ascending: false }).limit(1);
    const lastSent = last?.[0]?.sent_at ? new Date(last[0].sent_at as string) : null;
    if (lastSent && daysBetween(today, asOfCivil(lastSent)) < cfg.overdueEveryDays) continue;
    const r = await dispatch(db, p, reportMonth, "location", mLabel, dLabel, dryRun);
    out.push({ projectId: p.id, projectName: p.name, reminderType: "location", ...r });
  }
  return out;
}
