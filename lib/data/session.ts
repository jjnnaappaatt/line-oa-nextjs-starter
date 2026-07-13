import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin, USE_SUPABASE } from "@/lib/supabase/server";

/**
 * The LINE session is just an httpOnly cookie holding the verified LINE userId (see
 * app/api/line/link/route.ts — the userId is only trusted after the LIFF access token is verified
 * against our channel). Server components read it here to render "as" that LINE user.
 */
export const SESSION_COOKIE = "line_session";

export type LineUser = { lineUserId: string; displayName: string | null; pictureUrl: string | null };

/** The logged-in LINE userId (from the cookie), or null. */
export async function currentLineUserId(): Promise<string | null> {
  const c = await cookies();
  return c.get(SESSION_COOKIE)?.value ?? null;
}

/** The logged-in user's stored profile (requires the DB). Null when logged out or DB-less. */
export async function currentLineUser(): Promise<LineUser | null> {
  const id = await currentLineUserId();
  if (!id || !USE_SUPABASE) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from("line_users")
    .select("line_user_id,display_name,picture_url")
    .eq("line_user_id", id)
    .maybeSingle();
  if (!data) return null;
  return { lineUserId: data.line_user_id, displayName: data.display_name, pictureUrl: data.picture_url };
}

/** Upsert a LINE user's profile on login (no-op without the DB). */
export async function upsertLineUser(u: LineUser): Promise<void> {
  if (!USE_SUPABASE) return;
  const db = supabaseAdmin();
  await db.from("line_users").upsert(
    {
      line_user_id: u.lineUserId,
      display_name: u.displayName,
      picture_url: u.pictureUrl,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" },
  );
}
