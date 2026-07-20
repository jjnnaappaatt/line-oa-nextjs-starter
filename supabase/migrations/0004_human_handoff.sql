-- Serverless-safe conversation state (twin of webhook_await_issue): the "talk to a human" handoff.
-- When a user asks for a real person, this row makes the bot go SILENT until the TTL expires or the user
-- resumes, so a staff member can reply from the LINE Official Account Manager console without the bot
-- talking over them. Row Level Security stays OFF (service-role-only access), matching the rest of the schema.
create table if not exists public.webhook_human_handoff (
  chat_id     text primary key,                   -- userId / groupId / roomId
  expires_at  timestamptz not null
);
