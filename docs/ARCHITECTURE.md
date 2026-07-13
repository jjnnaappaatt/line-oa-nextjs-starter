# Architecture

The whole app is three fundamentals plus a scheduled job. This doc explains each, and a few design
choices worth understanding before you adapt it.

## 1. LINE Login (LIFF) → session

`components/line/LiffProvider.tsx` runs on the client. When the page is opened **inside LINE** and the
user is logged in, it grabs the **LIFF access token** and POSTs it to `app/api/line/link/route.ts`.

The server never trusts a userId sent from the browser. Instead it:

1. calls `https://api.line.me/oauth2/v2.1/verify?access_token=…` and checks `client_id` equals your
   `LINE_LOGIN_CHANNEL_ID` — proving the token was minted for *your* channel,
2. calls `https://api.line.me/v2/profile` with that token to get the **authoritative** userId,
3. sets an httpOnly cookie (`line_session`) with that userId.

That verify-then-fetch sequence is the crux: a client can lie about a userId, but it cannot forge a
token that verifies against your channel. Server components then read the cookie (`lib/data/session.ts`).

`LiffProvider` is **strictly additive**: with no `NEXT_PUBLIC_LIFF_ID`, or in a normal browser, it does
nothing and the app renders as usual. It never redirects to login on mount (doing so mid-hydration hangs
the LINE/iOS WebView); login is imperative, via the `login()` it exposes.

## 2. Signed inbound webhook

`app/api/webhooks/line/route.ts` reads the **raw** request body, verifies the `X-Line-Signature`
header, then dispatches. Signature verification (`verifyLineSignature` in `lib/line/push.ts`) is:

```
HMAC-SHA256(rawBody, LINE_CHANNEL_SECRET)  →  base64  →  constant-time compare with the header
```

Two details that matter:
- Verify against the **raw bytes**, before any JSON parsing/re-serialization — re-encoding changes the
  hash.
- The route **always returns 200** (even when a handler throws). LINE treats any non-200 as a delivery
  failure and retries aggressively, so each event is isolated in its own try/catch inside `handleWebhook`.

`lib/line/webhook.ts` dispatches by event type: `follow`/`join`, `unfollow`/`leave`, `postback` (RSVP),
and text `message` (commands). Because serverless functions keep **no in-memory state** between
requests, the multi-turn "report an issue" flow stores its "waiting for the next message" state in a DB
row with a TTL (`webhook_await_issue`).

## 3. Outbound push + Flex

`lib/line/push.ts` is a ~120-line client over the Messaging API: `pushText`, `pushMessages`,
`replyMessages`, plus read-only `getBotInfo`/`getProfile`. `replyMessages` uses the event's single-use
`replyToken` and is **free**; `push*` count against your monthly quota — reply when you can.

`lib/line/flex.ts` builds [Flex Messages](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/)
— rich JSON "bubbles". `eventInviteFlex` shows the interactive pattern: its buttons are **postback**
actions carrying `rsvp:{id}:{yes|no}`, which come back to the webhook when tapped. Design your own in
the [Flex Simulator](https://developers.line.biz/flex-simulator/).

## The scheduled reminder engine

`lib/line/reminders.ts` runs two idempotent passes, driven by the `notifications` log:

- **`runReminderPass`** — monthly submission reminders escalating **advance → due → overdue**. The
  state machine `nextReminderType` decides what (if anything) to send today, given what's already been
  sent this month. Only a real `sent` row counts as "done", so a project that gains its first contact
  mid-month still gets reminded.
- **`runLocationReminderPass`** — a "finish your one-time setup" nudge that repeats every
  `overdue_every_days` until `projects.verified_at` is set, then stops.

All day math happens in one fixed timezone (`lib/time.ts`, `REMINDER_UTC_OFFSET_HOURS`), comparing
**civil-day to civil-day** so a daily cadence is genuinely daily under the send-hour gate — not
every-other-day (a subtle bug you get if you compare a civil midnight to a raw timestamp).

`app/api/cron/reminders/route.ts` is pinged hourly and only runs the passes when the local hour equals
the admin-configured `send_hour`. So the schedule is dumb and the DB decides the time.

## Design choices

### No `@line/bot-sdk`
Everything the SDK would do — bearer-token push, signature verification, profile lookup — is a handful
of visible `fetch`/`crypto` lines here. For learning that's the point. In production the SDK is a fine
choice; you'll recognize every method once you've read this.

### Service-role + explicit actor (`p_actor`)
The server uses the Supabase **service-role** key (`lib/supabase/server.ts`), which bypasses Row Level
Security. A consequence: inside any Postgres function or policy, `auth.uid()` is **NULL** — there is no
authenticated user, because the connection authenticated as the service role. So anything that needs to
know "who did this" must be **passed in explicitly**. You see it in `web_line_subscribe(p_line_user_id,
…)` and throughout the data layer.

### RPC vs. direct table write
This starter keeps exactly one stored procedure (`web_line_subscribe`) to show the pattern, and does
everything else as plain table reads/writes from TypeScript. When to prefer each:

- **Direct writes** (default): simplest, fully visible in your app code, easy to test.
- **An RPC** when you need **atomicity across multiple statements**, want to enforce an invariant close
  to the data, or want to expose one narrow, `SECURITY DEFINER` operation. The cost is that logic now
  lives in SQL, away from your app — use it deliberately, not by default.

### Graceful degradation
Every integration is optional at boot. No LINE token → senders return `line_token_not_set`. No LIFF id →
`LiffProvider` is a no-op. No DB (`NEXT_PUBLIC_DATA_SOURCE` ≠ `supabase`) → DB-backed routes return
`database not configured` instead of throwing. This lets you stand the app up and wire integrations in
one at a time.
