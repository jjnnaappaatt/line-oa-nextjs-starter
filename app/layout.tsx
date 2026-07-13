import type { Metadata } from "next";
import "./globals.css";
import { LiffProvider } from "@/components/line/LiffProvider";

export const metadata: Metadata = {
  title: "LINE OA Next.js Starter",
  description: "A self-contained example of a LINE Official Account web app on Next.js.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* LiffProvider is additive: a no-op in a normal browser, LINE-aware inside the LINE client. */}
        <LiffProvider>{children}</LiffProvider>
      </body>
    </html>
  );
}
