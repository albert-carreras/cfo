import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Icon } from "./icons";
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
            <Link href="/tax" className="desk-icon">
              <Icon name="tax" />
              Tax
            </Link>
            <Link href="/plans" className="desk-icon">
              <Icon name="folder" />
              Plans
            </Link>
            <Link href="/inputs" className="desk-icon">
              <Icon name="folder" />
              Inputs
            </Link>
            <Link href="/activity" className="desk-icon">
              <Icon name="folder" />
              Activity
            </Link>
            <a href="/api/export" download className="desk-icon">
              <Icon name="doc" />
              Brief.md
            </a>
          </nav>
          <div className="desk-main">{children}</div>
        </div>
        <Taskbar />
      </body>
    </html>
  );
}
