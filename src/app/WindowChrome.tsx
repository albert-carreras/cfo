"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type CSSProperties } from "react";
import { CopyBrief } from "./CopyBrief";
import { XpIcon, type XpIconName } from "./icons";

const NAV: { href: string; label: string; icon: XpIconName }[] = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Balances", icon: "refresh" },
  { href: "/activity", label: "Activity", icon: "history" },
];

const TITLES: [string, string][] = [
  ["/change", "Something happened"],
  ["/activity", "Activity"],
  ["/tax", "Tax"],
  ["/plans", "Plans"],
  ["/inputs", "Inputs"],
  ["/item", "Item"],
];

// The button lit for this page: Overview, Something happened or Activity.
function activeHref(path: string) {
  if (path === "/") return "/";
  if (path.startsWith("/change")) return "/change";
  if (path.startsWith("/activity")) return "/activity";
  return null;
}

function pageTitle(path: string) {
  if (path === "/") return "Overview";
  return TITLES.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
}

// The window's fixed top: title bar, logo capsule and the button row that is
// the main navigation. It stays put while the page underneath scrolls.
export function WindowChrome() {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const title = pageTitle(pathname);
  const year = new Date().getFullYear();

  // On phones the whole window scrolls (title bar pinned); start each page at the top.
  useEffect(() => {
    document.querySelector(".window")?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <header className="win-head">
      <div className="titlebar">
        <XpIcon name="briefcase" className="titlebar-icon" />
        <span className="titlebar-text">{title ? `CFO ${year} - ${title}` : `CFO ${year}`}</span>
        <span className="titlebar-buttons" aria-hidden="true">
          <span className="tb tb-min" />
          <span className="tb tb-max" />
          <span className="tb tb-close" />
        </span>
      </div>
      <div className="logobar">
        <Link href="/" className="logo">
          <XpIcon name="briefcase" className="logo-icon" />
          <span className="logo-text">CFO</span>
          <span className="logo-year">{year}</span>
        </Link>
        <span className="logobar-tag">Every number verified or calculated.</span>
        {/* Decorative equalizer. Not data. */}
        <span className="eq" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </span>
      </div>
      <nav className="toolbar" aria-label="Main">
        <div className="toolbar-main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="tool"
              aria-current={active === item.href ? "page" : undefined}
            >
              <XpIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </div>
        <div className="toolbar-tools">
          <CopyBrief />
          <a href="/api/export" download className="tool">
            <XpIcon name="save" />
            .md
          </a>
        </div>
      </nav>
    </header>
  );
}
