import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushMessages } from "@/lib/line/push";
import { statusFlex } from "@/lib/line/flex";
import { LIFF } from "@/lib/line/liff";
import { currentReportMonth } from "@/lib/time";

/**
 * Manual (admin-triggered) reminders + the notifications log reader. The scheduled/automatic engine
 * lives in lib/line/reminders.ts; this is the "send it right now" path an operator uses.
 */
export type ReminderKind = "submit" | "location";
export type ReminderResult = { ok: boolean; projectName: string; sent: number; failed: number; skipped: number; error?: string };

/** Push a manual reminder to every active LINE contact of ONE project, logging each attempt. */
export async function sendProjectReminder(projectId: number, kind: ReminderKind): Promise<ReminderResult> {
  const db = supabaseAdmin();
  const { data: proj } = await db.from("projects").select("name").eq("id", projectId).maybeSingle();
  const projectName = proj?.name ?? `#${projectId}`;
  if (!proj) return { ok: false, projectName, sent: 0, failed: 0, skipped: 0, error: "unknown_project" };

  const { data: contacts } = await db
    .from("contacts")
    .select("line_user_id")
    .eq("project_id", projectId)
    .eq("active", true);
  const month = currentReportMonth(new Date());
  const rows = (contacts ?? []) as { line_user_id: string | null }[];
  let sent = 0, failed = 0, skipped = 0;

  const flex = statusFlex({
    tone: "warning",
    headline: kind === "submit" ? "📤 Monthly submission reminder" : "📍 Please finish project setup",
    title: projectName,
    button: kind === "submit"
      ? { label: "Submit", uri: LIFF("/submit") }
      : { label: "Verify", uri: LIFF("/status") },
    altText: kind === "submit"
      ? `Reminder: please submit this month's report for ${projectName}.`
      : `Reminder: please complete the one-time setup for ${projectName}.`,
  });

  for (const c of rows) {
    const now = new Date().toISOString();
    if (!c.line_user_id) {
      skipped++;
      await db.from("notifications").insert({
        project_id: projectId, report_month: month, channel: "none", recipient: null,
        reminder_type: "manual", status: "skipped", error: "no_line_id", sent_at: now,
      });
      continue;
    }
    const r = await pushMessages(c.line_user_id, [flex]);
    if (r.ok) sent++; else failed++;
    await db.from("notifications").insert({
      project_id: projectId, report_month: month, channel: "line", recipient: c.line_user_id,
      reminder_type: "manual", status: r.ok ? "sent" : "failed",
      error: r.error ?? null, provider_message_id: r.messageId ?? null, sent_at: now,
    });
  }
  return { ok: failed === 0, projectName, sent, failed, skipped };
}

/** Remind every project still "pending" for this kind — submit → not completed this month;
 *  location → one-time setup (verified_at) not done yet. */
export async function sendReminderToPending(
  kind: ReminderKind,
): Promise<{ results: ReminderResult[]; sent: number; failed: number; skipped: number }> {
  const db = supabaseAdmin();
  let targetIds: number[];
  if (kind === "submit") {
    const month = currentReportMonth(new Date());
    const [{ data: projs }, { data: subs }] = await Promise.all([
      db.from("projects").select("id").eq("active", true),
      db.from("submissions").select("project_id").eq("report_month", month).eq("status", "completed"),
    ]);
    const done = new Set(((subs ?? []) as { project_id: number }[]).map((s) => s.project_id));
    targetIds = ((projs ?? []) as { id: number }[]).map((p) => p.id).filter((id) => !done.has(id));
  } else {
    const { data: projs } = await db.from("projects").select("id").eq("active", true).is("verified_at", null);
    targetIds = ((projs ?? []) as { id: number }[]).map((p) => p.id);
  }
  const results: ReminderResult[] = [];
  for (const id of targetIds) results.push(await sendProjectReminder(id, kind));
  return {
    results,
    sent: results.reduce((s, r) => s + r.sent, 0),
    failed: results.reduce((s, r) => s + r.failed, 0),
    skipped: results.reduce((s, r) => s + r.skipped, 0),
  };
}

export type ReminderLogEntry = {
  id: number; projectName: string; month: string; channel: string; recipient: string | null;
  reminderType: string; status: string; error: string | null; sentAt: string | null;
};

/** Recent notifications log entries, newest first. */
export async function getReminderLog(limit = 100): Promise<ReminderLogEntry[]> {
  const db = supabaseAdmin();
  const [{ data: logs }, { data: projs }] = await Promise.all([
    db.from("notifications")
      .select("id,project_id,report_month,channel,recipient,reminder_type,status,error,sent_at")
      .order("sent_at", { ascending: false }).limit(limit),
    db.from("projects").select("id,name"),
  ]);
  const nameOf = new Map<number, string>();
  for (const p of (projs ?? []) as { id: number; name: string }[]) nameOf.set(p.id, p.name);
  return ((logs ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    projectName: r.project_id == null ? "—" : nameOf.get(Number(r.project_id)) ?? `#${r.project_id}`,
    month: String(r.report_month ?? ""), channel: String(r.channel ?? ""),
    recipient: (r.recipient as string) ?? null, reminderType: String(r.reminder_type ?? ""),
    status: String(r.status ?? ""), error: (r.error as string) ?? null, sentAt: (r.sent_at as string) ?? null,
  }));
}
