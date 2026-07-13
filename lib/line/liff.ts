import "server-only";

/**
 * LIFF deep-link helper (used by webhook replies and Flex buttons). Returns a `liff.line.me/<id><path>`
 * URL that opens this app INSIDE the LINE client when `NEXT_PUBLIC_LIFF_ID` is set; otherwise falls
 * back to the plain public web URL. So the same button works both inside LINE and in a normal browser.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || "";

export const LIFF = (path = ""): string =>
  LIFF_ID ? `https://liff.line.me/${LIFF_ID}${path}` : `${APP_URL}${path}`;
