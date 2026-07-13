import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only admin client (service-role key — never imported by a client component).
 *
 * The service-role key bypasses Row Level Security, so `auth.uid()` is NULL inside any
 * RPC or policy this client triggers. That is why write RPCs in this project take an
 * explicit actor argument (see `web_line_subscribe(p_line_user_id, ...)` and the
 * `p_actor` note in docs/ARCHITECTURE.md) instead of relying on `auth.uid()`.
 */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** True only when the DB is fully configured. Routes check this and degrade gracefully otherwise. */
export const USE_SUPABASE =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;
