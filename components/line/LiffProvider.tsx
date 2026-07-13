"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

export type LineProfile = { userId: string; displayName: string; pictureUrl: string | null };
export type LineAccount = { id: string; name: string; pictureUrl: string | null };

type LiffState = {
  ready: boolean;
  inClient: boolean;
  profile: LineProfile | null;
  account: LineAccount | null;
  error: string | null;
};

type LiffApi = LiffState & {
  /** Open an EXTERNAL url — uses liff.openWindow inside LINE (where target=_blank is blocked). */
  openExternal: (url: string) => void;
  /** Imperative LINE login — for flows that need the LINE userId (link / subscribe). Pass `redirectUri`
   *  (e.g. the current page) so a browser login returns here. Never called on mount (a redirect during
   *  hydration made mobile WebViews hang). No-op when already logged in / outside LINE. */
  login: (opts?: { redirectUri?: string }) => void;
};

const initial: LiffState = { ready: false, inClient: false, profile: null, account: null, error: null };

const fallbackOpenExternal = (url: string) => {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
};

const LiffContext = createContext<LiffApi>({ ...initial, openExternal: fallbackOpenExternal, login: () => {} });
export const useLiff = () => useContext(LiffContext);

/** Same-origin paths only (open-redirect guard). */
function safeInternalPath(value: string | null): string | null {
  if (!value) return null;
  let p: string;
  try {
    p = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  return p;
}

/**
 * Wraps the app with LINE/LIFF awareness — **strictly additive**: in a normal browser (no LIFF id, or
 * not opened inside LINE) it is a silent no-op and the app renders normally. When it IS inside LINE and
 * the user is logged in, it exchanges the LIFF access token for a session at /api/line/link.
 */
export function LiffProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiffState>(initial);
  const liffRef = useRef<unknown>(null);
  const refreshedRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  // Deep-link router: if a page still carries liff.state/to in its URL, route to it (idempotent).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const target = safeInternalPath(params.get("liff.state")) ?? safeInternalPath(params.get("to"));
    if (target && target.split("?")[0] !== pathname) router.replace(target);
  }, [pathname, router]);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return; // LINE not configured → standalone web, no-op.

    let cancelled = false;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        liffRef.current = liff;
        await liff.init({ liffId });
        const inClient = liff.isInClient();

        if (!liff.isLoggedIn()) {
          // Do NOT redirect to LINE login on mount — a navigation mid-hydration makes the LINE/iOS
          // WebView hold the first paint. Inside LINE the user is normally already logged in; the rare
          // not-logged-in case can call login() on demand.
          if (!cancelled) setState({ ...initial, ready: true, inClient });
          return;
        }

        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          if (!cancelled) setState({ ...initial, ready: true, inClient });
          return;
        }

        const res = await fetch("/api/line/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) {
          setState({
            ready: true, inClient,
            profile: data?.line ?? null, account: data?.account ?? null, error: null,
          });
          // The session cookie is set by /api/line/link AFTER render, so refresh the RSC tree once so
          // server components see the new identity immediately.
          if (data?.account && !refreshedRef.current) {
            refreshedRef.current = true;
            router.refresh();
          }
        }
      } catch (e) {
        if (!cancelled) setState({ ...initial, ready: true, error: e instanceof Error ? e.message : "liff error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const openExternal = useCallback((url: string) => {
    const liff = liffRef.current as
      | { isInClient?: () => boolean; openWindow?: (o: { url: string; external: boolean }) => void }
      | null;
    try {
      if (liff?.isInClient?.() && liff.openWindow) {
        liff.openWindow({ url, external: true });
        return;
      }
    } catch {
      /* fall through to a normal new tab */
    }
    fallbackOpenExternal(url);
  }, []);

  const login = useCallback((opts?: { redirectUri?: string }) => {
    const liff = liffRef.current as
      | { isLoggedIn?: () => boolean; login?: (o?: { redirectUri?: string }) => void }
      | null;
    try {
      if (liff?.login && !liff.isLoggedIn?.()) {
        liff.login(opts?.redirectUri ? { redirectUri: opts.redirectUri } : undefined);
      }
    } catch {
      /* no-op outside LINE */
    }
  }, []);

  return <LiffContext.Provider value={{ ...state, openExternal, login }}>{children}</LiffContext.Provider>;
}
