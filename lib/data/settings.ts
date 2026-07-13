import "server-only";
import { supabaseAdmin, USE_SUPABASE } from "@/lib/supabase/server";

export type MonitorSettings = {
  notificationsEnabled: boolean;
  locationRemindersEnabled: boolean;
  deadlineDay: number;
  advanceDays: number;
  overdueEveryDays: number;
  sendHour: number;
};

const DEFAULTS: MonitorSettings = {
  notificationsEnabled: true,
  locationRemindersEnabled: true,
  deadlineDay: 25,
  advanceDays: 7,
  overdueEveryDays: 1,
  sendHour: 9,
};

/** Read the admin-configurable settings singleton (row id = 1). Falls back to defaults when the DB
 *  isn't configured or the row is missing. `overdueEveryDays` is clamped to [1, 30]. */
export async function getMonitorSettings(): Promise<MonitorSettings> {
  if (!USE_SUPABASE) return DEFAULTS;
  const db = supabaseAdmin();
  const { data } = await db
    .from("settings")
    .select("notifications_enabled,location_reminders_enabled,deadline_day,advance_days,overdue_every_days,send_hour")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return DEFAULTS;
  return {
    notificationsEnabled: data.notifications_enabled ?? DEFAULTS.notificationsEnabled,
    locationRemindersEnabled: data.location_reminders_enabled ?? DEFAULTS.locationRemindersEnabled,
    deadlineDay: data.deadline_day ?? DEFAULTS.deadlineDay,
    advanceDays: data.advance_days ?? DEFAULTS.advanceDays,
    overdueEveryDays: Math.min(30, Math.max(1, data.overdue_every_days ?? DEFAULTS.overdueEveryDays)),
    sendHour: data.send_hour ?? DEFAULTS.sendHour,
  };
}
