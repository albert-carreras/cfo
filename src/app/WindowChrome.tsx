"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type CSSProperties } from "react";
import { CopyBrief } from "./CopyBrief";
import { XpIcon, type XpIconName } from "./icons";
import { mainHistory, setBusy, useMainHistory } from "./nav";
import { describe, parentOf } from "./routes";
import { wm } from "./wm";

const NAV: { href: string; label: string; icon: XpIconName }[] = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Balances", icon: "refresh" },
  { href: "/activity", label: "Activity", icon: "history" },
];

// The button lit for a page.
function activeHref(url: string) {
  const parsed = new URL(url, "http://cfo.local");
  if (parsed.pathname === "/") return "/";
  if (parsed.pathname === "/change") return parsed.searchParams.get("do") === "values" ? "/change?do=values" : "/change";
  if (parsed.pathname === "/activity") return "/activity";
  return null;
}

// The main window's address, with its query when known.
function useMainUrl(path: string) {
  const history = useMainHistory();
  const current = history.stack[history.index];
  return current && current.split("?")[0] === path ? current : path;
}

// The fixed top of the main window under its title bar: logo capsule, the
// button row that is the main navigation, and an Explorer-style address bar.
export function WindowChrome({ path }: { path: string }) {
  const url = useMainUrl(path);
  const year = new Date().getFullYear();
  // Like a tab, a pressed button lights at once; the page follows.
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const active = pending && pending.from === url ? pending.href : activeHref(url);

  return (
    <>
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
              onClick={() => setPending({ href: item.href, from: url })}
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
      <Suspense fallback={<AddressBar url={url} />}>
        <LiveAddressBar path={path} url={url} />
      </Suspense>
    </>
  );
}

function LiveAddressBar({ path, url }: { path: string; url: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // When the address is this window's own page, its query is right here.
  return <AddressBar url={pathname === path ? (search ? `${path}?${search}` : path) : url} />;
}

function AddressBar({ url }: { url: string }) {
  const router = useRouter();
  const history = useMainHistory();
  const up = parentOf(url);
  const go = (to: string | null) => {
    if (!to) return;
    setBusy(true);
    wm.open("main");
    router.push(to);
  };
  return (
    <div className="addressbar">
      <button
        type="button"
        className="nav-btn nav-back"
        disabled={history.index <= 0}
        onClick={() => go(mainHistory.step(-1))}
        title="Back"
      >
        <XpIcon name="back" />
        <span className="nav-label">Back</span>
      </button>
      <button
        type="button"
        className="nav-btn"
        disabled={history.index >= history.stack.length - 1}
        onClick={() => go(mainHistory.step(1))}
        aria-label="Forward"
        title="Forward"
      >
        <XpIcon name="forward" />
      </button>
      <button type="button" className="nav-btn" disabled={!up} onClick={() => go(up)} aria-label="Up" title="Up">
        <XpIcon name="up" />
      </button>
      <span className="addr-sep" aria-hidden="true" />
      <span className="addr-label">Address</span>
      <span className="addr-field">
        <XpIcon name="folder-open" />
        <span className="addr-text">{["CFO", ...describe(url)].join("\\")}</span>
      </span>
    </div>
  );
}
