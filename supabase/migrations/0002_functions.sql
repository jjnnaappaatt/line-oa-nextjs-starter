-- ─────────────────────────────────────────────────────────────────────────────
--  web_line_subscribe() — the one stored procedure this starter keeps, to show the
--  "explicit actor" pattern.
--
--  Because the server calls the DB with the SERVICE-ROLE key, `auth.uid()` is NULL
--  inside any function/policy. So instead of reading the caller from the session, we
--  pass the identity in explicitly (`p_line_user_id`). That is the same reason the
--  TypeScript data layer passes an actor argument to its writes. Everything this
--  function does could also be a plain upsert from TypeScript — see
--  docs/ARCHITECTURE.md for when to prefer an RPC vs. a direct table write.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.web_line_subscribe(
  p_project_id  int,
  p_line_user_id text,
  p_name        text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.projects where id = p_project_id and active;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_or_inactive_project');
  end if;

  insert into public.contacts (project_id, line_user_id, display_name, active)
  values (p_project_id, p_line_user_id, p_name, true)
  on conflict (project_id, line_user_id)
  do update set active = true, display_name = coalesce(excluded.display_name, public.contacts.display_name);

  return jsonb_build_object('ok', true, 'project', v_name);
end;
$$;
