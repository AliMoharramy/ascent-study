import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentSession } from "@/server/http";
import { SyncProvider } from "@/ui/SyncProvider";

export const metadata: Metadata = {
  title: { default: "THE ASCENT", template: "%s · THE ASCENT" },
  description: "Personal gamified study + habit engine",
  icons: { icon: "/icons/icon-512.png", apple: "/icons/icon-512.png" },
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0E0E10", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession().catch(() => null);
  const theme = session?.user.theme ?? "night";
  return (
    <html lang="en" dir="ltr" data-theme={theme}>
      <body className="bg-bg text-ink">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <SyncProvider />
      </body>
    </html>
  );
}
