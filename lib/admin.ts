/**
 * Minimal shared-secret gate for the demo admin + push endpoints. A real app would use proper
 * sessions/roles; this keeps the starter focused on the LINE plumbing. Send the secret as
 * `Authorization: Bearer <ADMIN_SECRET>`.
 */
export function isAdmin(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // no secret configured → locked by default
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
