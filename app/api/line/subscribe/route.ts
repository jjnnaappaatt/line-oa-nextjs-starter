import { NextResponse } from "next/server";
import { supabaseAdmin, USE_SUPABASE } from "@/lib/supabase/server";
import { upsertLineUser, SESSION_COOKIE } from "@/lib/data/session";

export const dynamic = "force-dynamic";

/**
 * One-tap subscribe from a LIFF page: `liff.line.me/<LIFF_ID>/subscribe?pid=<projectId>`. The page sends
 * the LIFF access token + project id; we verify the token, resolve the real userId, and subscribe the
 * user to the project via `web_line_subscribe` (which upserts the contacts row). Requires the DB.
 */
export async function POST(req: Request) {
  if (!USE_SUPABASE) {
    return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 });
  }
  let accessToken = "";
  let pid = 0;
  try {
    const body = await req.json();
    accessToken = String(body?.accessToken ?? "");
    pid = Number(body?.pid ?? 0);
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  if (!accessToken || !pid) {
    return NextResponse.json({ ok: false, error: "accessToken and pid required" }, { status: 400 });
  }

  // Verify token belongs to our LINE Login channel, then fetch the authoritative profile.
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!verifyRes.ok) {
    return NextResponse.json({ ok: false, error: "invalid LINE token" }, { status: 401 });
  }
  const verify = (await verifyRes.json()) as { client_id?: string };
  if (channelId && verify.client_id !== channelId) {
    return NextResponse.json({ ok: false, error: "token channel mismatch" }, { status: 401 });
  }
  const profRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profRes.ok) {
    return NextResponse.json({ ok: false, error: "profile fetch failed" }, { status: 401 });
  }
  const profile = (await profRes.json()) as { userId: string; displayName: string; pictureUrl?: string };
  const lineUserId = profile.userId;

  await upsertLineUser({
    lineUserId,
    displayName: profile.displayName ?? null,
    pictureUrl: profile.pictureUrl ?? null,
  });

  // The RPC takes the identity explicitly (service-role → auth.uid() is NULL). See supabase/migrations.
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("web_line_subscribe", {
    p_project_id: pid,
    p_line_user_id: lineUserId,
    p_name: profile.displayName ?? null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const r = (data ?? {}) as { ok?: boolean; project?: string; error?: string };

  const res = NextResponse.json({ ok: r.ok !== false, project: r.project ?? null, error: r.error });
  res.cookies.set(SESSION_COOKIE, lineUserId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
