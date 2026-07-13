"use client";

import { useLiff } from "@/components/line/LiffProvider";
import { ConnectLineButton } from "@/components/line/ConnectLineButton";

export default function Home() {
  const { ready, inClient, profile, error } = useLiff();

  return (
    <main className="container">
      <h1 style={{ marginBottom: 4 }}>LINE OA · Next.js Starter</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        A from-scratch example of the fundamentals of a LINE Official Account web app — no{" "}
        <code>@line/bot-sdk</code>, every LINE call is a visible <code>fetch</code>.
      </p>

      <section className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>LIFF session</h2>
        {!ready ? (
          <p className="muted">Initializing… (in a normal browser with no LIFF id configured this stays idle — that's expected.)</p>
        ) : profile ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {profile.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.pictureUrl} alt="" width={44} height={44} style={{ borderRadius: "50%" }} />
            ) : null}
            <div>
              <div style={{ fontWeight: 600 }}>{profile.displayName}</div>
              <div className="muted" style={{ fontSize: 13 }}>Signed in with LINE{inClient ? " (inside LINE)" : ""}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <p className="muted" style={{ margin: 0 }}>Not signed in. Open this page inside LINE, or connect your account:</p>
            <ConnectLineButton />
          </div>
        )}
        {error ? <p style={{ color: "#dc2626", fontSize: 13 }}>LIFF error: {error}</p> : null}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>What this demonstrates</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li><strong>LINE Login (LIFF)</strong> → verify the access token → httpOnly session cookie (<code>/api/line/link</code>)</li>
          <li><strong>Signed webhook</strong> → <code>X-Line-Signature</code> verification → command bot + RSVP (<code>/api/webhooks/line</code>)</li>
          <li><strong>Outbound push</strong> + Flex messages (<code>/api/push</code>, <code>lib/line/flex.ts</code>)</li>
          <li><strong>Scheduled reminders</strong> with advance/due/overdue escalation (<code>/api/cron/reminders</code>)</li>
          <li><strong>RSVP round-trip</strong> — push an invite, users tap, postbacks are stored (<code>/subscribe</code> + admin events)</li>
        </ul>
        <p className="muted" style={{ marginBottom: 0, marginTop: 12, fontSize: 13 }}>
          See <code>README.md</code> and <code>docs/LINE_SETUP.md</code> to wire it to a real Official Account.
        </p>
      </section>
    </main>
  );
}
