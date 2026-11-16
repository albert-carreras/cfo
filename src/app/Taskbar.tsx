"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { forgetTransfersClosed, formatRate, useTraySpeed } from "./Downloader";
import { XpIcon, type XpIconName } from "./icons";
import { appear, restoreFromTaskbar, vanish } from "./winfx";
import { useWm, wm, type WinId } from "./wm";

type Entry = { href: string; label: string; icon: XpIconName };

const MENU: Entry[] = [
  { href: "/", label: "Overview", icon: "my-computer" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Update balances", icon: "refresh" },
  { href: "/tax", label: "Tax", icon: "calculator" },
  { href: "/plans", label: "Plans", icon: "scheduled-tasks" },
  { href: "/inputs", label: "Inputs", icon: "control-panel" },
  { href: "/activity", label: "Activity", icon: "event-viewer" },
];

const TASK_ORDER: WinId[] = ["main", "side", "transfers"];

// The wall clock in the tray. Not a figure from the record.
function subscribeClock(onChange: () => void) {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
}
const clockNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const clockServer = () => "";

export function Taskbar() {
  const s = useWm();
  const menu = useRef<HTMLDetailsElement>(null);
  const time = useSyncExternalStore(subscribeClock, clockNow, clockServer);
  const tray = useTraySpeed();
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

  // A taskbar button: restore a minimized window, minimize the window in
  // front, or bring a window behind to the front.
  function press(id: WinId) {
    const w = s.wins[id];
    if (w.minimized) restoreFromTaskbar(id);
    else if (s.focused === id) vanish(id);
    else wm.focus(id);
  }

  function pressTray(event: React.MouseEvent<HTMLButtonElement>) {
    const w = s.wins.transfers;
    forgetTransfersClosed();
    if (!w.open || w.minimized) appear("transfers", event.currentTarget.getBoundingClientRect());
    else if (s.focused === "transfers") vanish("transfers");
    else wm.focus("transfers");
  }

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
            {MENU.map((item) => (
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
      <div className="tasks">
        {TASK_ORDER.filter((id) => s.wins[id].open).map((id) => {
          const w = s.wins[id];
          const pressed = s.focused === id && !w.minimized;
          return (
            <button
              key={id}
              type="button"
              data-task={id}
              className={pressed ? "task is-pressed" : "task"}
              aria-pressed={pressed}
              onClick={() => press(id)}
              title={w.title}
            >
              <XpIcon name={w.icon} />
              <span className="task-text">{w.title}</span>
            </button>
          );
        })}
      </div>
      <span className="tray">
        <button
          type="button"
          className="tray-net"
          onClick={pressTray}
          title={`Transfers: ${formatRate(tray.speed)} down`}
          aria-label="Transfers"
        >
          <XpIcon name="network" className={tray.blink ? "tray-icon is-rx" : "tray-icon"} />
          <span className="tray-rate">{formatRate(tray.speed)}</span>
        </button>
        <XpIcon name="volume" />
        <span className="tray-clock">{time}</span>
      </span>
    </div>
  );
}
