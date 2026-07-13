import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushMessages } from "@/lib/line/push";
import { eventInviteFlex } from "@/lib/line/flex";

/**
 * Events + region-targeted invites — the RSVP round-trip demo. Create an event, push a Flex invite to
 * every LINE contact whose project is in a target region, and read back the RSVPs the webhook stored
 * from the postback taps. (The RSVP WRITE lives in lib/line/webhook.ts `handleRsvp`.)
 */
export type EventRow = {
  id: number; title: string; hostRegion: string; targetRegions: string[]; venue: string;
  when: string; details: string; status: string; recipientCount: number; sentCount: number;
  failedCount: number; sentAt: string | null; createdAt: string; yesCount: number; noCount: number;
  imageUrl: string | null;
};
export type EventRsvp = { id: number; contactName: string | null; response: string; respondedAt: string | null };

function splitRegions(csv: string | null): string[] {
  return (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Distinct regions that have active projects (for the target picker). */
export async function getRegions(): Promise<string[]> {
  const db = supabaseAdmin();
  const { data } = await db.from("projects").select("region").eq("active", true);
  return [...new Set(((data ?? []) as { region: string | null }[]).map((r) => r.region).filter(Boolean) as string[])].sort();
}

export async function getEvents(): Promise<EventRow[]> {
  const db = supabaseAdmin();
  const [{ data: events }, { data: rsvps }] = await Promise.all([
    db.from("events")
      .select("id,title,host_region,target_regions,venue,event_when,details,status,recipient_count,sent_count,failed_count,sent_at,created_at,image_url")
      .order("created_at", { ascending: false }),
    db.from("event_rsvps").select("event_id,response"),
  ]);
  const yes = new Map<number, number>(), no = new Map<number, number>();
  for (const r of (rsvps ?? []) as { event_id: number; response: string }[]) {
    const m = r.response === "yes" ? yes : no;
    m.set(r.event_id, (m.get(r.event_id) ?? 0) + 1);
  }
  return ((events ?? []) as Record<string, unknown>[]).map((v) => ({
    id: Number(v.id), title: String(v.title ?? ""), hostRegion: String(v.host_region ?? ""),
    targetRegions: splitRegions(v.target_regions as string | null), venue: String(v.venue ?? ""),
    when: String(v.event_when ?? ""), details: String(v.details ?? ""), status: String(v.status ?? "draft"),
    recipientCount: Number(v.recipient_count ?? 0), sentCount: Number(v.sent_count ?? 0),
    failedCount: Number(v.failed_count ?? 0), sentAt: (v.sent_at as string) ?? null,
    createdAt: String(v.created_at ?? ""), yesCount: yes.get(Number(v.id)) ?? 0, noCount: no.get(Number(v.id)) ?? 0,
    imageUrl: (v.image_url as string) ?? null,
  }));
}

export async function getEventRsvps(eventId: number): Promise<EventRsvp[]> {
  const db = supabaseAdmin();
  const { data } = await db.from("event_rsvps")
    .select("id,contact_name,response,responded_at")
    .eq("event_id", eventId).order("responded_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id), contactName: (r.contact_name as string) ?? null,
    response: String(r.response ?? ""), respondedAt: (r.responded_at as string) ?? null,
  }));
}

export async function createEvent(input: {
  title: string; hostRegion: string; targetRegions: string[]; venue: string; when: string; details: string;
  imageUrl?: string | null;
}): Promise<{ ok: boolean; id?: number; error?: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("events").insert({
    title: input.title, host_region: input.hostRegion,
    target_regions: input.targetRegions.join(","), venue: input.venue,
    event_when: input.when, details: input.details, image_url: input.imageUrl ?? null, status: "draft",
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: Number(data.id) };
}

export async function cancelEvent(id: number): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { error } = await db.from("events").update({ status: "cancelled" }).eq("id", id);
  return { ok: !error, error: error?.message };
}

/** Push the invite Flex to every active LINE contact whose project operates in a target region. */
export async function sendEvent(id: number): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const db = supabaseAdmin();
  const { data: v } = await db.from("events")
    .select("id,title,host_region,target_regions,venue,event_when,details,status,image_url").eq("id", id).maybeSingle();
  if (!v) return { ok: false, sent: 0, failed: 0, error: "not_found" };
  if (v.status === "cancelled") return { ok: false, sent: 0, failed: 0, error: "cancelled" };
  const targets = splitRegions(v.target_regions as string | null);
  if (!targets.length) return { ok: false, sent: 0, failed: 0, error: "no_target_regions" };

  const { data: projs } = await db.from("projects").select("id").in("region", targets).eq("active", true);
  const pids = [...new Set(((projs ?? []) as { id: number }[]).map((p) => p.id))];
  if (!pids.length) return { ok: false, sent: 0, failed: 0, error: "no_projects_in_regions" };

  const { data: contacts } = await db.from("contacts")
    .select("line_user_id").in("project_id", pids).eq("active", true).not("line_user_id", "is", null);
  const recipients = [...new Set(((contacts ?? []) as { line_user_id: string }[]).map((c) => c.line_user_id))];
  if (!recipients.length) return { ok: false, sent: 0, failed: 0, error: "no_recipients" };

  const flex = eventInviteFlex({
    id: Number(v.id), title: String(v.title ?? ""), hostRegion: String(v.host_region ?? ""),
    venue: String(v.venue ?? ""), when: String(v.event_when ?? ""), details: String(v.details ?? ""),
    imageUrl: (v.image_url as string) ?? null,
  });
  let sent = 0, failed = 0;
  for (const to of recipients) {
    const r = await pushMessages(to, [flex]);
    if (r.ok) sent++; else failed++;
  }
  await db.from("events").update({
    status: "sent", recipient_count: recipients.length, sent_count: sent, failed_count: failed,
    sent_at: new Date().toISOString(),
  }).eq("id", id);
  return { ok: failed === 0, sent, failed };
}
