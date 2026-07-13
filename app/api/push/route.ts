import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { pushText } from "@/lib/line/push";

export const dynamic = "force-dynamic";

/**
 * Demo endpoint: send a plain-text push to a LINE user/group. Gated by ADMIN_SECRET.
 *
 *   curl -X POST http://localhost:3000/api/push \
 *     -H "Authorization: Bearer $ADMIN_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"to":"Uxxxxxxxx...","text":"Hello from my LINE OA!"}'
 */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let to = "", text = "";
  try {
    const body = await req.json();
    to = String(body?.to ?? "");
    text = String(body?.text ?? "");
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!to || !text) return NextResponse.json({ error: "to and text required" }, { status: 400 });
  const result = await pushText(to, text);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
