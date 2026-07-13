import { currentLineUser } from "@/lib/data/session";

/**
 * Placeholder for the "verify your project setup" page. The location/setup reminder deep-links here;
 * completing it would set `projects.verified_at`, which stops that nudge.
 */
export default async function StatusPage() {
  const me = await currentLineUser();
  return (
    <main className="container">
      <h1>Project status / setup</h1>
      <p className="muted">
        {me ? `Signed in as ${me.displayName ?? me.lineUserId}.` : "Not signed in with LINE."} This is a
        placeholder — the &quot;finish setup&quot; reminder deep-links here. Completing it would set{" "}
        <code>projects.verified_at</code>, which stops the repeating nudge.
      </p>
      <p className="muted"><a href="/">← Back</a></p>
    </main>
  );
}
