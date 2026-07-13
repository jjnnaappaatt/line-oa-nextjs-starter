# LINE setup — from zero to working

This app talks to **two** LINE channels:

1. a **Messaging API** channel — the Official Account (OA) that sends/receives messages, and
2. a **LINE Login** channel with a **LIFF app** — so users can log in and open the app inside LINE.

Both live under one **Provider** in the [LINE Developers Console](https://developers.line.biz/console/). Everything below maps to a variable in `.env.example`.

---

## A. Messaging API channel (the Official Account)

1. Console → create a **Provider** → **Create a new channel** → **Messaging API**.
2. **Messaging API** tab:
   - **Issue** a long-lived **channel access token** → `LINE_CHANNEL_ACCESS_TOKEN` (used for push + reply).
   - Set the **Webhook URL** to `https://YOUR-APP/api/webhooks/line` and turn **Use webhook = ON**.
   - Turn **Auto-reply messages** and **Greeting messages = OFF** (this bot sends its own greeting on `follow`).
3. **Basic settings** tab → copy the **Channel secret** → `LINE_CHANNEL_SECRET`. This verifies the
   `X-Line-Signature` header on every webhook call, so forged requests are rejected (see
   `verifyLineSignature` in `lib/line/push.ts`).
4. Get the OA's **add-friend link** (Messaging API tab → *Bot basic ID* `@xxxx` → `https://line.me/R/ti/p/@xxxx`).
   Users must **add the OA as a friend** to receive pushes.

> **Local testing:** LINE must reach your webhook over HTTPS. Run `ngrok http 3000` (or similar) and use
> the public URL as the Webhook URL. Then press **Verify** in the console — it should say Success.

## B. LINE Login channel + LIFF (in-app login)

1. Console → same Provider → **Create a new channel** → **LINE Login**.
2. **Basic settings** → copy the **Channel ID** → `LINE_LOGIN_CHANNEL_ID`. We check that every LIFF access
   token was minted for *this* channel before trusting the userId it carries (`app/api/line/link`).
3. **LIFF** tab → **Add**:
   - **Endpoint URL** = `https://YOUR-APP/` (your deployed app root),
   - **Size** = Full (or Tall),
   - **Scopes** = `profile` (and `openid` if you want),
   - Create it and copy the **LIFF ID** → `NEXT_PUBLIC_LIFF_ID`.
4. The one-tap subscribe page opens at `https://liff.line.me/<LIFF_ID>/subscribe?pid=<projectId>`.

## C. Environment variables

| Variable | For |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | push + reply (Messaging API) |
| `LINE_CHANNEL_SECRET` | webhook signature verification |
| `LINE_LOGIN_CHANNEL_ID` | validating LIFF access tokens |
| `NEXT_PUBLIC_LIFF_ID` | LIFF init + deep links (public) |
| `NEXT_PUBLIC_APP_URL` | fallback base URL for deep links (public) |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_DATA_SOURCE=supabase` | database |
| `CRON_SECRET` | authorizes the reminder cron |
| `ADMIN_SECRET` | the demo admin + `/api/push` endpoints |
| `REMINDER_UTC_OFFSET_HOURS` | timezone for reminder day/hour math (default 7 = Bangkok) |

## D. Database

Apply the schema in `supabase/migrations/` with `supabase db push`, or paste the files into the Supabase
SQL editor in order (`0001` → `0002` → `0003`). It creates every table this app uses plus one demo
function and a couple of demo projects. The **send hour** and reminder cadence live in the `settings`
row (id = 1) and are meant to be admin-editable.

## E. Verify it works

1. `GET /api/admin/line-check` with `Authorization: Bearer $ADMIN_SECRET` → returns your OA's display
   name once `LINE_CHANNEL_ACCESS_TOKEN` is valid.
2. Add the OA as a friend → you get the welcome reply (`follow`). Type `help` → the menu.
3. `POST /api/push` (admin-gated) with your own LINE `userId` → you receive the push.
4. `GET /api/admin/reminder-preview` (admin-gated) → a **dry run** showing exactly who *would* be
   reminded now, without sending anything.

Until the LINE vars are set, the app still runs — the webhook links/handles events where it can, and
pushes simply log `line_token_not_set` (harmless). Set the vars to go live.

## F. Scheduling reminders

- **Vercel (default):** `vercel.json` registers a **daily** cron hitting `/api/cron/reminders`. Set the
  cron time to include your desired local send hour, set `CRON_SECRET` in the Vercel env, and set the
  matching `send_hour` in the `settings` row.
- **Sub-daily (any host):** Vercel Hobby only allows daily cron. To send at an exact hour regardless,
  ping the route **hourly** from an external scheduler — the route itself only acts during `send_hour`.
  With Supabase you can do this entirely in the database:

  ```sql
  -- enable once
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  -- store the secret in Vault, not inline
  select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');

  select cron.schedule('reminders-hourly', '0 * * * *', $$
    select net.http_get(
      '<YOUR-APP-URL>/api/cron/reminders',
      headers := jsonb_build_object('Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
    );
  $$);
  ```
