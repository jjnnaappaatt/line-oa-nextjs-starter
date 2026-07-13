import { currentLineUser } from "@/lib/data/session";

/**
 * Placeholder for the monthly-submission form. In a real app this is where a signed-in user enters
 * their report; the reminder Flex buttons deep-link here. It reads the LINE session to show who's in.
 */
export default async function SubmitPage() {
  const me = await currentLineUser();
  return (
    <main className="container">
      <h1>Submit monthly report</h1>
      <p className="muted">
        {me ? `Signed in as ${me.displayName ?? me.lineUserId}.` : "Not signed in with LINE."} This is a
        placeholder — put your submission form here. The reminder Flex buttons deep-link to this route.
      </p>
      <p className="muted"><a href="/">← Back</a></p>
    </main>
  );
}
