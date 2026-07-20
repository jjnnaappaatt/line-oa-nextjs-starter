import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { replyMessages, getProfile } from "./push";
import { LIFF } from "./liff";
import { currentReportMonth, monthLabel } from "@/lib/time";
import { matchCommand, isCancel, labelOf, type CommandKey } from "./fuzzy";

/**
 * Inbound LINE bot handler. Dispatches each webhook event by type:
 *   • follow / join      → welcome + register prompt
 *   • unfollow / leave   → deactivate the user's contacts
 *   • postback           → RSVP (from the event invite Flex buttons)
 *   • message + text     → command matching (help/list/status/manage/report) + issue-capture flow
 *
 * Each event is isolated (one failure doesn't abort the batch). Replies use `replyToken` (free) plus
 * quick-reply chips. Conversation state (the "report an issue" wait) lives in a DB row because
 * serverless functions keep no in-memory state between requests.
 */
type Db = ReturnType<typeof supabaseAdmin>;

const STATUS_LABEL: Record<string, string> = {
  not_started: "not started", in_progress: "in progress", completed: "completed",
};

// ── reply helpers ──────────────────────────────────────────────────────────
type QrItem = { type: "action"; action: Record<string, string> };
const chip = (label: string, text: string): QrItem => ({ type: "action", action: { type: "message", label, text } });
const DEFAULT_QR: QrItem[] = [
  chip("📋 My projects", "my projects"), chip("📊 Status", "status"),
  chip("⚙️ Manage", "manage"), chip("🙋 Human", "talk to a human"), chip("💬 Help", "help"),
  { type: "action", action: { type: "uri", label: "🌐 Open app", uri: LIFF("/") } },
];
const textMsg = (text: string, chips: QrItem[] = DEFAULT_QR) => ({ type: "text", text, quickReply: { items: chips.slice(0, 13) } });
async function reply(replyToken: string | undefined, text: string, chips: QrItem[] = DEFAULT_QR) {
  if (replyToken) await replyMessages(replyToken, [textMsg(text, chips)]);
}

const REGISTER_PROMPT =
  `🔔 You're not subscribed yet.\nOpen the app to pick the project(s) you want reminders for:\n${LIFF("/")}\n\nType "status" to see this month's progress.`;
const MENU_TEXT =
  `📋 Menu — type or tap a button below:\n• my projects — the projects you follow\n• status — this month's submission progress\n• manage — manage / unsubscribe\n• report — report an issue to the team\n• talk to a human — reach a real person in this chat\n• help — show this menu`;

async function projectMap(db: Db): Promise<Map<number, string>> {
  const { data } = await db.from("projects").select("id,name").eq("active", true);
  return new Map(((data ?? []) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
}
async function activeSubs(db: Db, lineUserId: string): Promise<number[]> {
  const { data } = await db.from("contacts").select("project_id").eq("line_user_id", lineUserId).eq("active", true);
  return [...new Set(((data ?? []) as { project_id: number }[]).map((c) => c.project_id))];
}

// ── issue-capture state (webhook_await_issue table; serverless-safe) ─────────
async function isAwaiting(db: Db, chatId: string): Promise<boolean> {
  const { data } = await db.from("webhook_await_issue").select("expires_at").eq("chat_id", chatId).maybeSingle();
  if (!data) return false;
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await db.from("webhook_await_issue").delete().eq("chat_id", chatId);
    return false;
  }
  return true;
}
async function setAwaiting(db: Db, chatId: string) {
  await db.from("webhook_await_issue").upsert({ chat_id: chatId, expires_at: new Date(Date.now() + 15 * 60000).toISOString() });
}
async function clearAwaiting(db: Db, chatId: string) {
  await db.from("webhook_await_issue").delete().eq("chat_id", chatId);
}

// ── human-handoff state (webhook_human_handoff table; serverless-safe) ────────
// Twin of the issue-capture table above. When a user asks for a real person, the bot goes SILENT for this
// window so a staff member's manual replies (typed from the LINE Official Account Manager console) aren't
// drowned out by auto-replies. Refreshed on each message; an exact command / "resume" / cancel hands
// control back early. "Going silent" is trivial here: the bot only ever answers via replyToken, so simply
// not calling reply() means no message. This is an app-level flag, independent of LINE's console chat/bot mode.
const HANDOFF_TTL_MS = 30 * 60000;
async function isHandedOff(db: Db, chatId: string): Promise<boolean> {
  const { data } = await db.from("webhook_human_handoff").select("expires_at").eq("chat_id", chatId).maybeSingle();
  if (!data) return false;
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await db.from("webhook_human_handoff").delete().eq("chat_id", chatId);
    return false;
  }
  return true;
}
async function setHandoff(db: Db, chatId: string) {
  await db.from("webhook_human_handoff").upsert({ chat_id: chatId, expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString() });
}
async function clearHandoff(db: Db, chatId: string) {
  await db.from("webhook_human_handoff").delete().eq("chat_id", chatId);
}

const ISSUE_LIMIT_PER_HOUR = 10;
async function issueRateLimited(db: Db, lineUserId: string): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("issues")
    .select("id", { count: "exact", head: true }).eq("line_user_id", lineUserId).gte("created_at", since);
  return (count ?? 0) >= ISSUE_LIMIT_PER_HOUR;
}

async function reporterName(db: Db, lineUserId: string): Promise<string | null> {
  const { data: contact } = await db.from("contacts").select("display_name")
    .eq("line_user_id", lineUserId).not("display_name", "is", null)
    .order("subscribed_at", { ascending: false }).limit(1).maybeSingle();
  let name = (contact?.display_name as string | undefined)?.trim() || null;
  if (!name) {
    const p = await getProfile(lineUserId);
    if (p.ok && p.name) name = p.name.trim();
  }
  return name;
}

async function createIssue(db: Db, description: string, lineUserId: string): Promise<string> {
  const name = await reporterName(db, lineUserId);
  const body = [description.trim(), name ? `— reporter: ${name}` : null].filter(Boolean).join("\n").slice(0, 2000);
  const { data } = await db.from("issues")
    .insert({ description: body, line_user_id: lineUserId, status: "open", created_at: new Date().toISOString() })
    .select("id").single();
  if (!data) throw new Error("issue insert failed");
  const id = Number(data.id);
  const ticket = `OA-${1000 + id}`;
  await db.from("issues").update({ ticket }).eq("id", id);
  return ticket;
}

// ── command handlers ────────────────────────────────────────────────────────
async function cmdList(db: Db, targetId: string, replyToken?: string) {
  const subs = await activeSubs(db, targetId);
  if (!subs.length) return reply(replyToken, REGISTER_PROMPT);
  const pmap = await projectMap(db);
  const lines = subs.map((id) => `• ${pmap.get(id) ?? `#${id}`}`).join("\n");
  await reply(replyToken, `📋 Projects you follow (${subs.length})\n${lines}\n\nSubmit this month's report:\n${LIFF("/submit")}`);
}
async function cmdStatus(db: Db, targetId: string, replyToken?: string) {
  const subs = await activeSubs(db, targetId);
  if (!subs.length) return reply(replyToken, REGISTER_PROMPT);
  const pmap = await projectMap(db);
  const rm = currentReportMonth(new Date());
  const { data: submissions } = await db.from("submissions").select("project_id,status").in("project_id", subs).eq("report_month", rm);
  const statusOf = new Map(((submissions ?? []) as { project_id: number; status: string }[]).map((s) => [s.project_id, s.status]));
  let done = 0;
  const lines = subs.map((id) => {
    const sv = statusOf.get(id) ?? "not_started";
    if (sv === "completed") done++;
    const icon = sv === "completed" ? "✅" : sv === "in_progress" ? "🟡" : "⬜";
    return `${icon} ${pmap.get(id) ?? `#${id}`} — ${STATUS_LABEL[sv] ?? sv}`;
  }).join("\n");
  await reply(replyToken, `📊 Submission status · ${monthLabel(rm)}\nDone ${done}/${subs.length}\n\n${lines}`);
}
async function cmdManage(db: Db, targetId: string, replyToken?: string) {
  const subs = await activeSubs(db, targetId);
  if (!subs.length) return reply(replyToken, REGISTER_PROMPT);
  const pmap = await projectMap(db);
  const lines = subs.map((id) => `• ${pmap.get(id) ?? `#${id}`}\n   unsubscribe: type "cancel ${id}"`).join("\n");
  await reply(replyToken, `⚙️ Manage notifications (${subs.length})\n${lines}\n\nUnsubscribe from all: type "cancel all"`);
}
async function cmdReport(db: Db, targetId: string, replyToken?: string) {
  await setAwaiting(db, targetId);
  const qr: QrItem[] = [chip("Bot not replying", "The bot is not replying"), chip("Broken link", "A link doesn't work"), chip("Wrong data", "The data looks wrong"), chip("🙋 Talk to a human", "talk to a human")];
  await reply(replyToken, `🛠️ Report an issue\nType the problem you ran into and send it here — the team will take a look.\n(Want to talk to a person instead? Tap "🙋 Talk to a human".)`, qr);
}

/** Human handoff: pause the bot and let a staff member reply from the LINE OA Manager console. */
async function cmdHuman(db: Db, targetId: string, replyToken?: string) {
  await setHandoff(db, targetId);
  const qr: QrItem[] = [chip("↩️ Back to bot", "resume")];
  await reply(replyToken,
    `🙋 Connecting you to a team member.\nSend your question here and someone will reply in this chat during business hours. The automated bot is paused so it won't talk over the reply.\n\nType "resume" to switch back to the automated bot.`,
    qr);
}

async function dispatchCommand(db: Db, cmd: Exclude<CommandKey, "cancel">, targetId: string, replyToken?: string) {
  switch (cmd) {
    case "help": return reply(replyToken, MENU_TEXT);
    case "list": return cmdList(db, targetId, replyToken);
    case "status": return cmdStatus(db, targetId, replyToken);
    case "manage": return cmdManage(db, targetId, replyToken);
    case "report": return cmdReport(db, targetId, replyToken);
    case "human": return cmdHuman(db, targetId, replyToken);
    case "resume": {
      await clearHandoff(db, targetId);
      return reply(replyToken, `↩️ Back to the automated assistant. Type "help" to see commands.`);
    }
  }
}

async function handleCancel(db: Db, text: string, targetId: string, replyToken?: string) {
  const arg = text
    .replace(/cancel all/i, "all").replace(/cancel/i, "").replace(/unsubscribe/i, "")
    .replace(/unsub/i, "").replace(/stop/i, "").replace(/quit/i, "").trim();
  const subs = await activeSubs(db, targetId);
  const pmap = await projectMap(db);
  const unsub = async (pid: number) => {
    await db.from("contacts").update({ active: false }).eq("line_user_id", targetId).eq("project_id", pid);
  };

  if (["all", "*"].includes(arg.toLowerCase())) {
    for (const pid of subs) await unsub(pid);
    return reply(replyToken, "Unsubscribed from all projects ✅\nYou can subscribe again anytime in the app.");
  }
  if (arg) {
    const pid = subs.find((id) => String(id) === arg || (pmap.get(id) ?? "").toLowerCase().includes(arg.toLowerCase()));
    if (pid != null) { await unsub(pid); return reply(replyToken, `Unsubscribed ✅\n${pmap.get(pid) ?? `#${pid}`}`); }
    return reply(replyToken, "Couldn't find that project in your subscriptions.");
  }
  if (!subs.length) return reply(replyToken, REGISTER_PROMPT);
  return cmdManage(db, targetId, replyToken);
}

async function handleText(db: Db, text: string, targetId: string | null, replyToken?: string) {
  const t = (text || "").trim();
  // human-handoff: once the user asks for a person, the bot stays SILENT so a staff member's replies (sent
  // from the LINE OA Manager console) aren't drowned out. Only an exact command / "resume" / cancel returns
  // control to the bot; everything else is left for staff and refreshes the window.
  if (targetId && (await isHandedOff(db, targetId))) {
    const [hcmd, hexact] = matchCommand(t);
    if (hexact && hcmd && hcmd !== "human") {
      await clearHandoff(db, targetId); // exact command (incl. "resume") → hand control back, dispatch below
    } else if (isCancel(t)) {
      await clearHandoff(db, targetId);
      return reply(replyToken, `↩️ Back to the automated assistant. Type "help" to see commands.`);
    } else {
      await setHandoff(db, targetId); // still talking to staff → keep the bot quiet, refresh the window
      return; // silent — no bot reply
    }
  }
  // issue-capture: free text is captured as an issue; an exact command / cancel bails out first.
  if (targetId && (await isAwaiting(db, targetId))) {
    const [cmd, exact] = matchCommand(t);
    if ((exact && cmd) || isCancel(t)) {
      await clearAwaiting(db, targetId);
    } else {
      await clearAwaiting(db, targetId);
      if (await issueRateLimited(db, targetId)) {
        return reply(replyToken, "You've reported a lot recently — please wait a bit and try again. 🙏");
      }
      const ticket = await createIssue(db, t, targetId);
      return reply(replyToken, `✅ Got it\nTicket: ${ticket}\nThe team will look into it as soon as possible.`);
    }
  }
  if (isCancel(t)) { if (targetId) return handleCancel(db, t, targetId, replyToken); }

  const [cmd, , suggestions] = matchCommand(t);
  if (cmd && targetId) return dispatchCommand(db, cmd, targetId, replyToken);
  if (suggestions.length) {
    const chips = suggestions.map((c) => chip(labelOf(c), labelOf(c)));
    return reply(replyToken, `Did you mean… ${suggestions.map(labelOf).join(" / ")} ?`, chips);
  }
  if (targetId && (await activeSubs(db, targetId)).length) return reply(replyToken, MENU_TEXT);
  return reply(replyToken, REGISTER_PROMPT);
}

async function handleRsvp(db: Db, data: string, targetId: string | null, replyToken?: string) {
  const [tag, vidS, resp] = data.split(":");
  if (tag !== "rsvp" || (resp !== "yes" && resp !== "no") || !targetId) return;
  const vid = Number(vidS);
  const { data: event } = await db.from("events").select("id,title,event_when,venue").eq("id", vid).maybeSingle();
  if (!event) return;
  const { data: contact } = await db.from("contacts").select("display_name").eq("line_user_id", targetId).limit(1).maybeSingle();
  await db.from("event_rsvps").upsert(
    {
      event_id: vid, line_user_id: targetId,
      contact_name: (contact?.display_name as string | undefined) ?? null,
      response: resp, responded_at: new Date().toISOString(),
    },
    { onConflict: "event_id,line_user_id" },
  );
  let msg = resp === "yes" ? "✅ Saved — you're attending." : "✅ Saved — you can't make it.";
  msg += `\n📣 ${event.title}`;
  if (event.event_when) msg += `\n🗓 ${event.event_when}`;
  if (event.venue) msg += `\n📍 ${event.venue}`;
  if (replyToken) await replyMessages(replyToken, [{ type: "text", text: msg }]);
}

type LineEvent = {
  type?: string; replyToken?: string;
  source?: { userId?: string; groupId?: string; roomId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
};

/** Process a LINE webhook body. Each event is isolated (one failure doesn't abort the batch). */
export async function handleWebhook(body: { events?: LineEvent[] }): Promise<void> {
  const db = supabaseAdmin();
  for (const ev of body.events ?? []) {
    const replyToken = ev.replyToken;
    const src = ev.source ?? {};
    const targetId = src.groupId || src.roomId || src.userId || null;
    try {
      if (ev.type === "follow" || ev.type === "join") {
        await reply(replyToken, `👋 Welcome!\n\nOpen the app to subscribe to the project(s) you want reminders for:\n${LIFF("/")}\n\nType "help" to see all commands.`);
      } else if (ev.type === "unfollow" || ev.type === "leave") {
        if (targetId) await db.from("contacts").update({ active: false }).eq("line_user_id", targetId);
      } else if (ev.type === "postback") {
        await handleRsvp(db, ev.postback?.data ?? "", targetId, replyToken);
      } else if (ev.type === "message" && ev.message?.type === "text") {
        await handleText(db, ev.message.text ?? "", targetId, replyToken);
      }
    } catch (e) {
      try {
        const rm = currentReportMonth(new Date());
        await db.from("notifications").insert({
          project_id: null, report_month: rm, channel: "line", recipient: targetId,
          reminder_type: "error", status: "failed", error: String((e as Error).message).slice(0, 500), sent_at: new Date().toISOString(),
        });
      } catch { /* ignore log failure */ }
      try { if (replyToken) await replyMessages(replyToken, [{ type: "text", text: "Sorry — something went wrong. Please try again. 🙏" }]); } catch { /* ignore */ }
    }
  }
}
