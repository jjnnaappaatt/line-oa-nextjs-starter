"use client";

import { useLiff } from "@/components/line/LiffProvider";

/**
 * Runs LINE Login (returning to the current page) so the account gets its LINE userId + profile. The
 * "already linked / inside LINE" no-op is handled by LiffProvider. Uses LINE's brand green (#06C755).
 */
export function ConnectLineButton({ label = "Connect LINE account" }: { label?: string }) {
  const { login, ready } = useLiff();
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => login({ redirectUri: typeof window !== "undefined" ? window.location.href : undefined })}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44,
        padding: "0 18px", borderRadius: 10, border: "none", cursor: ready ? "pointer" : "default",
        background: "#06C755", color: "#fff", fontSize: 14, fontWeight: 600, opacity: ready ? 1 : 0.5,
      }}
    >
      <span
        style={{
          display: "grid", placeItems: "center", height: 16, width: 16, borderRadius: 4,
          background: "#fff", color: "#06C755", fontSize: 10, fontWeight: 800,
        }}
      >
        L
      </span>
      {label}
    </button>
  );
}
