import { NextResponse } from "next/server";
import { USE_SUPABASE } from "@/lib/supabase/server";
import { upsertLineUser, SESSION_COOKIE } from "@/lib/data/session";

export const dynamic = "force-dynamic";

/**
 * LINE Login via LIFF — links a LINE user to a browser session.
 *
 * The browser (LiffProvider) sends the LIFF **access token**, never a raw userId, so a client cannot
 * forge an identity. We:
 *   1. verify the token actually belongs to OUR LINE Login channel (oauth2/v2.1/verify),
 *   2. fetch the authoritative profile from LINE (/v2/profile) to get the real userId,
 *   3. persist the profile (if the DB is configured) and set an httpOnly session cookie so server
 *      components render as this LINE user.
 */
export async function POST(req: Request) {
  let accessToken = "";
  try {
    const body = await req.json();
    accessToken = String(body?.accessToken ?? "");
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!accessToken) {
    return NextResponse.json({ error: "accessToken required" }, { status: 400 });
  }

  // 1) Token must belong to our LINE Login channel.
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!verifyRes.ok) {
    return NextResponse.json({ error: "invalid LINE token" }, { status: 401 });
  }
  const verify = (await verifyRes.json()) as { client_id?: string };
  if (channelId && verify.client_id !== channelId) {
    return NextResponse.json({ error: "token channel mismatch" }, { status: 401 });
  }

  // 2) Authoritative profile (userId is trustworthy only because the token verified above).
  const profRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profRes.ok) {
    return NextResponse.json({ error: "profile fetch failed" }, { status: 401 });
  }
  const profile = (await profRes.json()) as { userId: string; displayName: string; pictureUrl?: string };
  const lineUserId = profile.userId;

  // 3) Persist (best-effort) + set the session cookie.
  if (USE_SUPABASE) {
    await upsertLineUser({
      lineUserId,
      displayName: profile.displayName ?? null,
      pictureUrl: profile.pictureUrl ?? null,
    });
  }

  const res = NextResponse.json({
    line: { userId: lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null },
    account: { id: lineUserId, name: profile.displayName, pictureUrl: profile.pictureUrl ?? null },
  });
  res.cookies.set(SESSION_COOKIE, lineUserId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
