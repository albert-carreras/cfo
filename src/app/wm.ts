"use client";

import { useSyncExternalStore } from "react";
import type { XpIconName } from "./icons";

// A tiny window manager: which windows are open, minimized or maximized, their
// stacking order and which one has focus. The taskbar and every window read it.

export type WinId = "main" | "side" | "transfers";
export type Win = { title: string; icon: XpIconName; open: boolean; minimized: boolean; maximized: boolean };
export type WmState = { wins: Record<WinId, Win>; order: WinId[]; focused: WinId | null };

const INITIAL: WmState = {
  wins: {
    main: { title: "CFO", icon: "briefcase", open: true, minimized: false, maximized: false },
    side: { title: "", icon: "briefcase", open: false, minimized: false, maximized: false },
    transfers: { title: "Transfers", icon: "network-places", open: false, minimized: false, maximized: false },
  },
  // Back to front.
  order: ["transfers", "side", "main"],
  focused: "main",
};

let state = INITIAL;
const listeners = new Set<() => void>();

function commit(next: WmState) {
  state = next;
  for (const listener of listeners) listener();
}

function raised(id: WinId): WinId[] {
  return [...state.order.filter((other) => other !== id), id];
}

function topVisible(wins: Record<WinId, Win>, except?: WinId): WinId | null {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const id = state.order[i];
    if (id !== except && wins[id].open && !wins[id].minimized) return id;
  }
  return null;
}

export const wm = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => state,
  server: () => INITIAL,

  set(id: WinId, patch: Partial<Win>) {
    const current = state.wins[id];
    if (Object.entries(patch).every(([key, value]) => current[key as keyof Win] === value)) return;
    commit({ ...state, wins: { ...state.wins, [id]: { ...current, ...patch } } });
  },
  focus(id: WinId) {
    if (state.focused === id && state.order.at(-1) === id) return;
    commit({ ...state, order: raised(id), focused: id });
  },
  open(id: WinId, patch: Partial<Win> = {}) {
    const wins = { ...state.wins, [id]: { ...state.wins[id], ...patch, open: true, minimized: false } };
    commit({ wins, order: raised(id), focused: id });
  },
  // Open and bring to the front without taking focus (a tool window).
  show(id: WinId) {
    const wins = { ...state.wins, [id]: { ...state.wins[id], open: true, minimized: false } };
    commit({ ...state, wins, order: raised(id) });
  },
  close(id: WinId) {
    const wins = { ...state.wins, [id]: { ...state.wins[id], open: false, minimized: false, maximized: false } };
    commit({ ...state, wins, focused: topVisible(wins, id) });
  },
  minimize(id: WinId) {
    const wins = { ...state.wins, [id]: { ...state.wins[id], minimized: true } };
    commit({ ...state, wins, focused: topVisible(wins, id) });
  },
  toggleMax(id: WinId) {
    const wins = { ...state.wins, [id]: { ...state.wins[id], maximized: !state.wins[id].maximized } };
    commit({ wins, order: raised(id), focused: id });
  },
};

export function useWm() {
  return useSyncExternalStore(wm.subscribe, wm.get, wm.server);
}

// Stacking: later in the order is in front.
export function zIndexOf(s: WmState, id: WinId) {
  return 10 + s.order.indexOf(id);
}
