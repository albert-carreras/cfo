"use client";

import { useSyncExternalStore } from "react";

// Navigation bookkeeping shared by the windows: the main window's own
// back/forward history (like an Explorer window, separate from any other
// window), the busy cursor while a page loads, where the last click came from
// (for the opening animation) and which window the last pointer press was in.

type History = { stack: string[]; index: number };

let history: History = { stack: [], index: -1 };
let travelling: string | null = null;
const listeners = new Set<() => void>();
const EMPTY: History = { stack: [], index: -1 };

function emit() {
  for (const listener of listeners) listener();
}

export const mainHistory = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => history,
  server: () => EMPTY,
  current: () => history.stack[history.index] ?? "/",
  // Called whenever the main window lands on a new address.
  visit(url: string) {
    if (travelling === url) {
      travelling = null;
      return;
    }
    if (history.stack[history.index] === url) return;
    const stack = [...history.stack.slice(0, history.index + 1), url];
    history = { stack, index: stack.length - 1 };
    emit();
  },
  // Back or forward: returns the address to go to.
  step(delta: -1 | 1): string | null {
    const index = history.index + delta;
    const url = history.stack[index];
    if (url === undefined) return null;
    history = { ...history, index };
    travelling = url;
    emit();
    return url;
  },
};

export function useMainHistory() {
  return useSyncExternalStore(mainHistory.subscribe, mainHistory.get, mainHistory.server);
}

// --- Busy cursor -------------------------------------------------------------

let busyTimer: ReturnType<typeof setTimeout> | undefined;

export function setBusy(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("is-busy", on);
  clearTimeout(busyTimer);
  // Never leave the hourglass up if a navigation goes nowhere.
  if (on) busyTimer = setTimeout(() => setBusy(false), 10_000);
}

// --- Where things were clicked -----------------------------------------------

let lastRect: DOMRect | null = null;

export function rememberRect(rect: DOMRect) {
  lastRect = rect;
}

export function takeRect(): DOMRect | null {
  const rect = lastRect;
  lastRect = null;
  return rect;
}

let submittedIn: string | null = null;
let submittedAt = 0;

// A form was sent from inside a window (by its data-win id).
export function noteSubmit(windowId: string | null) {
  submittedIn = windowId;
  submittedAt = Date.now();
}

export function recentSubmitIn(windowId: string, withinMs = 20_000) {
  return submittedIn === windowId && Date.now() - submittedAt < withinMs;
}

// --- The caption zoom --------------------------------------------------------

// Windows XP animates a title bar flying between a window and where it comes
// from or goes to (an icon, a taskbar button).
export function zoomCaption(from: DOMRect | null | undefined, to: DOMRect | null | undefined, title: string, done?: () => void) {
  if (typeof document === "undefined" || !from || !to || (to.width === 0 && to.height === 0)) {
    done?.();
    return;
  }
  const el = document.createElement("div");
  el.className = "zoom-caption";
  el.textContent = title;
  document.body.appendChild(el);
  const frame = (r: DOMRect) => {
    const height = Math.min(Math.max(r.height, 22), 31);
    return {
      left: `${r.left}px`,
      top: `${r.top + (r.height - height) / 2}px`,
      width: `${Math.max(r.width, 60)}px`,
      height: `${height}px`,
    };
  };
  const animation = el.animate([frame(from), frame(to)], { duration: 220, easing: "ease-out", fill: "forwards" });
  animation.onfinish = () => {
    el.remove();
    done?.();
  };
}
