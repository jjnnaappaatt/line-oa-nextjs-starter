import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getBotInfo } from "@/lib/line/push";

export const dynamic = "force-dynamic";

/** Read-only health check — confirms the LINE access token works (returns the OA display name). */
export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const info = await getBotInfo();
  return NextResponse.json(info, { status: info.ok ? 200 : 502 });
}
