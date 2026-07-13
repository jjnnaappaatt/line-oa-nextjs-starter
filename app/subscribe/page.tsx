"use client";

import { useEffect, useState } from "react";

type Phase = "loading" | "ok" | "error" | "login";

/**
 * LIFF one-tap subscribe. Opened from an add-friend / registration link via
 * `https://liff.line.me/<LIFF_ID>/subscribe?pid=<projectId>`. Inside LINE it captures the verified LINE
 * userId and subscribes server-side — no manual "send", works on mobile + desktop.
 */
export default function SubscribePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [project, setProject] = useState("");
  const [error, setError] = useState("");
  const [inClient, setInClient] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const pid = Number(params.get("pid"));
        if (!pid) {
          setError("Invalid link — no project id.");
          setPhase("error");
          return;
        }
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) {
          setError("LINE is not configured (NEXT_PUBLIC_LIFF_ID unset).");
          setPhase("error");
          return;
        }

        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
        setInClient(liff.isInClient());
        if (!liff.isLoggedIn()) {
          setPhase("login");
          liff.login();
          return;
        }
        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setError("Could not verify your LINE identity.");
          setPhase("error");
          return;
        }

        const res = await fetch("/api/line/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, pid }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; project?: string; error?: string };
        if (cancelled) return;
        if (res.ok && data.ok) {
          setProject(data.project ?? "");
          setPhase("ok");
        } else {
          setError(data.error ?? "Subscription failed, please try again.");
          setPhase("error");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const closeWindow = async () => {
    try {
      const liff = (await import("@line/liff")).default;
      if (liff.isInClient()) liff.closeWindow();
    } catch {
      /* no-op */
    }
  };

  return (
    <main className="container" style={{ display: "flex", justifyContent: "center" }}>
      <div className="card" style={{ width: "100%", maxWidth: 380, textAlign: "center", padding: 32 }}>
        {phase === "loading" || phase === "login" ? (
          <p className="muted">{phase === "login" ? "Signing in with LINE…" : "Subscribing…"}</p>
        ) : phase === "ok" ? (
          <>
            <div style={{ fontSize: 40 }}>✅</div>
            <h1 style={{ fontSize: 20 }}>Subscribed</h1>
            {project ? (
              <p className="muted">
                Project <strong style={{ color: "var(--ink)" }}>{project}</strong>
              </p>
            ) : null}
            <p className="muted" style={{ fontSize: 13 }}>
              You&apos;ll get this project&apos;s monthly submission reminders on LINE automatically.
            </p>
            {inClient ? (
              <button onClick={closeWindow} className="muted" style={{ marginTop: 16, background: "none", border: "none", cursor: "pointer" }}>
                Close
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontSize: 40 }}>⚠️</div>
            <h1 style={{ fontSize: 18 }}>Subscription failed</h1>
            <p className="muted">{error}</p>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 16, padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--line-green)", color: "#fff", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
