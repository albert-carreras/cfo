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

// --- Asking for a second window ---------------------------------------------

// Opening a window-of-its-own page asks the second window to show itself, even
// when it already holds that page (closed or minimized), where the route alone
// would not change.
type SideRequest = { path: string | null; n: number };
let sideRequest: SideRequest = { path: null, n: 0 };
const sideListeners = new Set<() => void>();
const NO_REQUEST: SideRequest = { path: null, n: 0 };

export function requestSide(path: string) {
  sideRequest = { path, n: sideRequest.n + 1 };
  for (const listener of sideListeners) listener();
}

export function currentSideRequest() {
  return sideRequest;
}

export function useSideRequest() {
  return useSyncExternalStore(
    (listener) => {
      sideListeners.add(listener);
      return () => {
        sideListeners.delete(listener);
      };
    },
    () => sideRequest,
    () => NO_REQUEST,
  );
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

// --- The zoom outline -------------------------------------------------------

// Classic Windows opening and minimizing: grey outline rectangles that grow
// from where a window comes from (an icon, a link, a taskbar button) up to the
// window, or shrink back down to its taskbar button.
export function zoomOutline(from: DOMRect | null | undefined, to: DOMRect | null | undefined, done?: () => void) {
  if (typeof document === "undefined" || !from || !to || to.width === 0 || to.height === 0) {
    done?.();
    return;
  }
  const frame = (r: DOMRect) => ({
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${Math.max(r.width, 24)}px`,
    height: `${Math.max(r.height, 16)}px`,
  });
  const steps = 4;
  const duration = 240;
  let finished = 0;
  for (let i = 0; i < steps; i++) {
    const el = document.createElement("div");
    el.className = "zoom-outline";
    el.style.opacity = "0";
    document.body.appendChild(el);
    const animation = el.animate(
      [
        { ...frame(from), opacity: 1 },
        { ...frame(to), opacity: 1 },
      ],
      { duration, delay: i * 45, easing: "linear", fill: "both" },
    );
    animation.onfinish = () => {
      el.remove();
      if (++finished === steps) done?.();
    };
  }
}
