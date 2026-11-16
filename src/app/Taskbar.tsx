"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icons";

const MENU: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Update balances", icon: "refresh" },
  { href: "/tax", label: "Tax", icon: "tax" },
  { href: "/plans", label: "Plans", icon: "folder" },
  { href: "/inputs", label: "Inputs", icon: "folder" },
  { href: "/activity", label: "Activity", icon: "list" },
];

function pageLabel(path: string) {
  if (path === "/") return "Overview";
  if (path.startsWith("/change")) return "Something happened";
  if (path.startsWith("/item")) return "Item";
  const hit = MENU.find((item) => item.href !== "/" && path.startsWith(item.href));
  return hit?.label ?? "CFO";
}

// The wall clock in the tray. Not a figure from the record.
function subscribeClock(onChange: () => void) {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
}
const clockNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
          <Icon name="briefcase" />
          CFO
        </summary>
        <nav className="start-menu" aria-label="All pages">
          <div className="start-head">CFO</div>
          {MENU.map((item) => (
            <Link key={item.href} href={item.href} onClick={close}>
              <Icon name={item.icon} className={`i-${item.icon}`} />
              {item.label}
            </Link>
          ))}
          <a href="/api/export" download onClick={close}>
            <Icon name="doc" />
            Download brief (.md)
          </a>
        </nav>
      </details>
      <span className="task">
        <Icon name="briefcase" />
        <span className="task-text">{pageLabel(pathname)}</span>
      </span>
      <span className="tray">{time}</span>
    </div>
  );
}
