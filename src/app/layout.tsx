import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { XpIcon, type XpIconName } from "./icons";
import { Taskbar } from "./Taskbar";

export const metadata: Metadata = {
  title: "CFO",
  description: "Personal financial record: what you own, what changed, what needs you.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

const DESKTOP: { href: string; label: string; icon: XpIconName; download?: boolean }[] = [
  { href: "/", label: "Overview", icon: "my-computer" },
  { href: "/tax", label: "Tax", icon: "calculator" },
  { href: "/plans", label: "Plans", icon: "scheduled-tasks" },
  { href: "/inputs", label: "Inputs", icon: "control-panel" },
  { href: "/activity", label: "Activity", icon: "event-viewer" },
  { href: "/api/export", label: "Brief.md", icon: "notepad", download: true },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="desktop">
          {/* Shortcuts on the wallpaper, shown when the screen is wide enough. */}
          <nav className="desk-icons" aria-label="Shortcuts">
            {DESKTOP.map((item) =>
              item.download ? (
                <a key={item.href} href={item.href} download className="desk-icon">
                  <XpIcon name={item.icon} />
                  {item.label}
                </a>
              ) : (
                <Link key={item.href} href={item.href} className="desk-icon">
                  <XpIcon name={item.icon} />
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <div className="desk-main">{children}</div>
        </div>
        <Taskbar />
      </body>
    </html>
  );
}
