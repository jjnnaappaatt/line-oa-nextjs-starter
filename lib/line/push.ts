import "server-only";
import crypto from "node:crypto";

/**
 * LINE Messaging API client — a thin, dependency-free wrapper over the REST API (NO @line/bot-sdk, so
 * every call is a visible `fetch`). Needs `LINE_CHANNEL_ACCESS_TOKEN` in the environment; every sender
 * is a no-op-with-error when it's unset, so the app runs fine before you wire up LINE.
 *
 * Docs: https://developers.line.biz/en/reference/messaging-api/
 */
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export type LineSend = { ok: boolean; status: number; messageId?: string; error?: string };

export function lineConfigured(): boolean {
  return !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
}

/**
 * Verify the `X-Line-Signature` header: HMAC-SHA256 of the RAW request body, keyed with
 * `LINE_CHANNEL_SECRET`, base64-encoded, compared in constant time. This is what proves an inbound
 * webhook actually came from LINE and not a forged request.
 *
 * With no secret set it returns true OFF production (so you can test the webhook locally) but
 * fails CLOSED in production.
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // length mismatch
  }
}

async function linePost(url: string, body: Record<string, unknown>): Promise<LineSend> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, status: 0, error: "line_token_not_set" };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `network: ${(e as Error).message}` };
  }
  const requestId = res.headers.get("x-line-request-id") ?? undefined;
  if (res.ok) {
    // The real per-message id is in the body (sentMessages[].id); fall back to the request-trace id.
    let messageId = requestId;
    try {
      const j = (await res.json()) as { sentMessages?: { id?: string }[] };
      messageId = j?.sentMessages?.[0]?.id ?? requestId;
    } catch {
      /* keep the request-trace id */
    }
    return { ok: true, status: res.status, messageId };
  }
  let error = `line_${res.status}`;
  try {
    const j = (await res.json()) as { message?: string };
    if (j?.message) error = `${error}: ${j.message}`;
  } catch {
    /* keep the status-only error */
  }
  return { ok: false, status: res.status, error };
}

/** Read-only health check: confirm the access token is valid (returns the OA display name). Sends no message. */
export async function getBotInfo(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "line_token_not_set" };
  try {
    const res = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const j = (await res.json()) as { displayName?: string };
      return { ok: true, name: j.displayName };
    }
    return { ok: false, error: `line_${res.status}` };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}

/** Read-only: fetch a LINE user's public display name (used to attribute a bot-reported issue). Best-effort. */
export async function getProfile(userId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "line_token_not_set" };
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const j = (await res.json()) as { displayName?: string };
      return { ok: true, name: j.displayName };
    }
    return { ok: false, error: `line_${res.status}` };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}

/** Push a plain-text message to one LINE user/group. */
export function pushText(to: string, text: string): Promise<LineSend> {
  return linePost(PUSH_URL, { to, messages: [{ type: "text", text }] });
}

/** Push already-built message objects (text/flex) to one LINE user/group. */
export function pushMessages(to: string, messages: unknown[]): Promise<LineSend> {
  return linePost(PUSH_URL, { to, messages });
}

/** Reply to a webhook event using its single-use replyToken (free — does not count against the push quota). */
export function replyMessages(replyToken: string, messages: unknown[]): Promise<LineSend> {
  return linePost(REPLY_URL, { replyToken, messages });
}
