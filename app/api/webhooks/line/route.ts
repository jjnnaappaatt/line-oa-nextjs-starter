import { NextResponse } from "next/server";
import { verifyLineSignature } from "@/lib/line/push";
import { handleWebhook } from "@/lib/line/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inbound LINE webhook. Verifies `X-Line-Signature` over the RAW body, then dispatches. Always returns
 * 200 to LINE (even on handler errors) so LINE doesn't retry-storm; each event is isolated inside
 * handleWebhook. Set this route's public URL as the Webhook URL in the LINE console.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature");
  if (!verifyLineSignature(raw, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: { events?: unknown[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }); // ack; LINE treats non-200 as a delivery failure
  }
  try {
    await handleWebhook(body as Parameters<typeof handleWebhook>[0]);
  } catch {
    // never fail the webhook — LINE retries aggressively on non-200
  }
  return NextResponse.json({ ok: true });
}

/** LINE's "Verify" button in the console sends a check to this URL; respond 200. */
export function GET() {
  return NextResponse.json({ ok: true });
}
