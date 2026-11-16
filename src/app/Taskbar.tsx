"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { XpIcon, type XpIconName } from "./icons";

type Entry = { href: string; label: string; icon: XpIconName };

const LEFT: Entry[] = [
  { href: "/", label: "Overview", icon: "my-computer" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Update balances", icon: "refresh" },
];
const RIGHT: Entry[] = [
  { href: "/tax", label: "Tax", icon: "calculator" },
  { href: "/plans", label: "Plans", icon: "scheduled-tasks" },
  { href: "/inputs", label: "Inputs", icon: "control-panel" },
  { href: "/activity", label: "Activity", icon: "event-viewer" },
];

function pageLabel(path: string) {
  if (path === "/") return "Overview";
  if (path.startsWith("/change")) return "Something happened";
  if (path.startsWith("/item")) return "Item";
  return RIGHT.find((item) => path.startsWith(item.href))?.label ?? "CFO";
}

// The wall clock in the tray. Not a figure from the record.
function subscribeClock(onChange: () => void) {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
}
const clockNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const clockServer = () => "";

export function Taskbar() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const time = useSyncExternalStore(subscribeClock, clockNow, clockServer);
  const close = () => menu.current?.removeAttribute("open");

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="taskbar">
      <details className="start" ref={menu}>
        <summary className="start-btn">
          <span className="start-logo" aria-hidden="true" />
          Start
        </summary>
        <nav className="start-menu" aria-label="All pages">
          <div className="start-banner" aria-hidden="true">
            <span>
              <b>CFO</b> {new Date().getFullYear()}
            </span>
          </div>
          <div className="start-items">
            {[...LEFT, ...RIGHT].map((item) => (
              <Link key={item.href} href={item.href} onClick={close}>
                <XpIcon name={item.icon} />
                {item.label}
              </Link>
            ))}
            <hr />
            <a href="/api/export" download onClick={close}>
              <XpIcon name="notepad" />
              Download brief (.md)
            </a>
          </div>
        </nav>
      </details>
      <span className="task">
        <XpIcon name="briefcase" />
        <span className="task-text">CFO - {pageLabel(pathname)}</span>
      </span>
      <span className="tray">
        <XpIcon name="volume" />
        {time}
      </span>
    </div>
  );
}
