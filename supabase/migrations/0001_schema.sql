-- ─────────────────────────────────────────────────────────────────────────────
--  LINE OA Next.js Starter — self-contained schema
--
--  Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--  Everything here is the single source of truth for the app — there is no hidden
--  second service. Row Level Security is intentionally left OFF: this app only ever
--  touches these tables through the SERVICE-ROLE key on the server (see
--  lib/supabase/server.ts), never from the browser, so `auth.uid()` is always NULL
--  and business rules live in the server code / the web_line_subscribe() function.
-- ─────────────────────────────────────────────────────────────────────────────

-- Identity: one row per LINE user who has logged in (via LIFF) or been linked.
create table if not exists public.line_users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text not null unique,           -- the "U…" id LINE assigns per OA
  display_name  text,
  picture_url   text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- The thing users subscribe to and report on monthly (rename to fit your domain).
create table if not exists public.projects (
  id           int generated always as identity primary key,
  name         text not null,
  region       text,                              -- used for event/region targeting
  active       boolean not null default true,
  verified_at  timestamptz,                       -- one-time setup step; the "location" nudge repeats until set
  created_at   timestamptz not null default now()
);

-- Subscription link: which LINE users get notifications for which project.
create table if not exists public.contacts (
  id             bigint generated always as identity primary key,
  project_id     int not null references public.projects(id) on delete cascade,
  line_user_id   text not null,
  display_name   text,
  active         boolean not null default true,
  subscribed_at  timestamptz not null default now(),
  unique (project_id, line_user_id)
);

-- Monthly submission state per project (report_month is ISO "YYYY-MM").
create table if not exists public.submissions (
  id            bigint generated always as identity primary key,
  project_id    int not null references public.projects(id) on delete cascade,
  report_month  text not null,
  status        text not null default 'not_started',   -- not_started | in_progress | completed
  updated_at    timestamptz not null default now(),
  unique (project_id, report_month)
);

-- Send / skip / fail log — provides idempotency for the reminder engine AND an audit trail.
create table if not exists public.notifications (
  id                   bigint generated always as identity primary key,
  project_id           int,                      -- nullable: errors may not belong to a project
  report_month         text,
  channel              text,                      -- line | none
  recipient            text,                      -- line_user_id or a name
  reminder_type        text,                      -- advance | due | overdue | location | manual | error
  status               text,                      -- sent | skipped | failed
  error                text,
  provider_message_id  text,
  sent_at              timestamptz not null default now()
);

-- Bot-reported issue tickets (from the "report an issue" chat flow).
create table if not exists public.issues (
  id            bigint generated always as identity primary key,
  ticket        text,                              -- e.g. "OA-1001"
  description   text not null,
  line_user_id  text,
  status        text not null default 'open',
  created_at    timestamptz not null default now()
);

-- Events (the RSVP round-trip demo): create → push invite Flex → collect postback RSVPs.
create table if not exists public.events (
  id               bigint generated always as identity primary key,
  title            text not null,
  host_region      text,
  target_regions   text,                           -- comma-separated regions to target
  venue            text,
  event_when       text,
  details          text,
  image_url        text,
  status           text not null default 'draft',  -- draft | sent | cancelled
  recipient_count  int not null default 0,
  sent_count       int not null default 0,
  failed_count     int not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.event_rsvps (
  id            bigint generated always as identity primary key,
  event_id      bigint not null references public.events(id) on delete cascade,
  line_user_id  text not null,
  contact_name  text,
  response      text not null,                     -- yes | no
  responded_at  timestamptz not null default now(),
  unique (event_id, line_user_id)
);

-- Serverless-safe conversation state: the "report an issue" flow waits for the user's next message.
-- (Serverless functions have no in-memory state between requests, so it lives in a row with a TTL.)
create table if not exists public.webhook_await_issue (
  chat_id     text primary key,                   -- userId / groupId / roomId
  expires_at  timestamptz not null
);

-- Admin-configurable settings — a single row (id = 1).
create table if not exists public.settings (
  id                          int primary key default 1 check (id = 1),
  notifications_enabled       boolean not null default true,
  location_reminders_enabled  boolean not null default true,
  deadline_day                int not null default 25,     -- day of month submissions are due
  advance_days                int not null default 7,      -- send an "advance" reminder N days before
  overdue_every_days          int not null default 1,      -- re-send cadence after the deadline (days)
  send_hour                   int not null default 9        -- local hour (0–23) the cron actually sends
);

create index if not exists notifications_project_month_idx
  on public.notifications (project_id, report_month);
create index if not exists notifications_type_status_idx
  on public.notifications (reminder_type, status);
create index if not exists contacts_line_user_idx on public.contacts (line_user_id);
