"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { XpIcon, type XpIconName } from "./icons";
import { rememberRect, setBusy } from "./nav";
import { isSideRoute } from "./routes";
import { appear } from "./winfx";
import { wm } from "./wm";

const ICONS: { href: string; label: string; icon: XpIconName; download?: boolean }[] = [
  { href: "/", label: "Overview", icon: "my-computer" },
  { href: "/tax", label: "Tax", icon: "calculator" },
  { href: "/plans", label: "Plans", icon: "scheduled-tasks" },
  { href: "/inputs", label: "Inputs", icon: "control-panel" },
  { href: "/activity", label: "Activity", icon: "event-viewer" },
  { href: "/api/export", label: "Brief.md", icon: "notepad", download: true },
];

const coarseQuery = "(pointer: coarse)";
const subscribeCoarse = (onChange: () => void) => {
  const media = window.matchMedia(coarseQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

// Desktop shortcuts: one click selects, a double click (or Enter) opens. On a
// touch screen one tap opens.
export function DesktopIcons() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const coarse = useSyncExternalStore(subscribeCoarse, () => window.matchMedia(coarseQuery).matches, () => false);

  // Clicking the wallpaper or a window clears the selection.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(".desk-icon")) setSelected(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function open(item: (typeof ICONS)[number], el: HTMLElement) {
    setSelected(item.href);
    if (item.download) {
      const link = document.createElement("a");
      link.href = item.href;
      link.download = "";
      link.click();
      return;
    }
    const rect = el.getBoundingClientRect();
    if (isSideRoute(item.href)) {
      // Opens in a window of its own, flying in from the icon.
      rememberRect(rect);
    } else {
      const main = wm.get().wins.main;
      if (!main.open || main.minimized) appear("main", rect);
      else wm.focus("main");
    }
    if (window.location.pathname + window.location.search !== item.href) setBusy(true);
    router.push(item.href);
  }

  return (
    <nav className="desk-icons" aria-label="Shortcuts">
      {ICONS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={item.download ? false : undefined}
          className={selected === item.href ? "desk-icon is-selected" : "desk-icon"}
          onClick={(event) => {
            // Keyboard (Enter) arrives with no click count: open.
            event.preventDefault();
            if (event.detail === 0 || coarse) open(item, event.currentTarget);
            else setSelected(item.href);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            open(item, event.currentTarget);
          }}
        >
          <XpIcon name={item.icon} />
          <span className="desk-label">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
