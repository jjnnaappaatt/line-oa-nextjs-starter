import "server-only";

/**
 * Flex Message builders — LINE's rich message format (JSON "bubbles"). These are the two shapes this
 * starter uses; they're plain objects you pass to `pushMessages`/`replyMessages`. `altText` MUST carry
 * the full plain-text message so notification previews and older clients lose nothing.
 *
 * Design your own bubbles in the Flex Message Simulator:
 * https://developers.line.biz/flex-simulator/
 */
const TONE_COLOR = { success: "#16a34a", warning: "#d97706", danger: "#dc2626" } as const;

function infoRow(label: string, value: string) {
  return {
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#8a8a8a", size: "sm", flex: 2 },
      { type: "text", text: value || "—", wrap: true, color: "#333333", size: "sm", flex: 5 },
    ],
  };
}

/**
 * Compact status/notification bubble — a color-coded header, optional bold title, optional info rows,
 * and one optional deep-link button. Good for reminders, approvals, "done" notices, etc.
 */
export function statusFlex(v: {
  tone: keyof typeof TONE_COLOR;
  headline: string;                          // header line, e.g. "✅ Request approved"
  title?: string;                            // bold body line (usually the subject/project name)
  rows?: [label: string, value: string][];   // info rows (label left, value right)
  button?: { label: string; uri: string };   // single deep-link button, colored by tone
  altText: string;
}): Record<string, unknown> {
  const bodyContents: Record<string, unknown>[] = [];
  if (v.title) bodyContents.push({ type: "text", text: v.title, weight: "bold", size: "md", wrap: true });
  if (v.rows?.length) {
    bodyContents.push({
      type: "box", layout: "vertical", spacing: "sm", margin: v.title ? "md" : "none",
      contents: v.rows.map(([l, val]) => infoRow(l, val)),
    });
  }
  return {
    type: "flex",
    altText: v.altText,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: TONE_COLOR[v.tone], paddingAll: "14px",
        contents: [{ type: "text", text: v.headline, color: "#ffffff", weight: "bold", size: "sm", wrap: true }],
      },
      ...(bodyContents.length
        ? { body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents } }
        : {}),
      ...(v.button
        ? {
            footer: {
              type: "box", layout: "vertical",
              contents: [{
                type: "button", style: "primary", color: TONE_COLOR[v.tone], height: "sm",
                action: { type: "uri", label: v.button.label, uri: v.button.uri },
              }],
            },
          }
        : {}),
    },
  };
}

/**
 * Event invite bubble with two RSVP **postback** buttons. The postback `data` (`rsvp:{id}:{yes|no}`)
 * comes back to the webhook when the user taps — that round-trip (push → user taps → postback →
 * stored) is the single best end-to-end demo of an interactive LINE bot. See lib/line/webhook.ts.
 */
export function eventInviteFlex(v: {
  id: number; title: string; hostRegion: string; venue: string; when: string; details: string;
  imageUrl?: string | null;
}): Record<string, unknown> {
  const hero = v.imageUrl
    ? { hero: { type: "image", url: v.imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" } }
    : {};
  return {
    type: "flex",
    altText: `Invitation: ${v.title}`,
    contents: {
      type: "bubble",
      ...hero,
      header: {
        type: "box", layout: "vertical", backgroundColor: "#d97706", paddingAll: "16px",
        contents: [{ type: "text", text: "📍 You're invited", color: "#ffffff", weight: "bold", size: "md", wrap: true }],
      },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: v.title, weight: "bold", size: "lg", wrap: true },
          { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: [
            infoRow("Region", v.hostRegion), infoRow("When", v.when), infoRow("Where", v.venue),
            ...(v.details ? [infoRow("Details", v.details)] : []),
          ] },
        ],
      },
      footer: {
        type: "box", layout: "horizontal", spacing: "sm",
        contents: [
          { type: "button", style: "primary", color: "#16a34a", height: "sm",
            action: { type: "postback", label: "✅ Attending", data: `rsvp:${v.id}:yes`, displayText: "Attending" } },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "postback", label: "❌ Can't make it", data: `rsvp:${v.id}:no`, displayText: "Can't make it" } },
        ],
      },
    },
  };
}
