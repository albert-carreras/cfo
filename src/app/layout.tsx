import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import { DesktopIcons } from "./DesktopIcons";
import { Downloader } from "./Downloader";
import { MainWindow } from "./MainWindow";
import { NavWatcher } from "./NavWatcher";
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

// The desktop: shortcuts on the wallpaper, the main window, a second window
// when a page opens in one of its own (the `win` slot), the transfers window
// and the taskbar.
export default function RootLayout({ children, win }: { children: ReactNode; win: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="desktop">
          <DesktopIcons />
          <div className="desk-main">
            <MainWindow>{children}</MainWindow>
            {win}
          </div>
        </div>
        <Downloader />
        <Taskbar />
        <Suspense fallback={null}>
          <NavWatcher />
        </Suspense>
      </body>
    </html>
  );
}
