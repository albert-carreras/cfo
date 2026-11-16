"use client";

import { zoomOutline } from "./nav";
import { wm, type WinId } from "./wm";

function windowOf(id: WinId) {
  return document.querySelector<HTMLElement>(`[data-win="${id}"]`);
}

function taskButtonOf(id: WinId) {
  return document.querySelector(`[data-task="${id}"]`);
}

// Open or restore a window: the outline grows from `from` (an icon, a link,
// a taskbar button) to the window, then the window appears.
export function appear(id: WinId, from: DOMRect | null | undefined) {
  if (!from) {
    wm.open(id);
    return;
  }
  // Hidden from its first paint until the outline has arrived.
  const root = document.documentElement;
  root.classList.add(`opening-${id}`);
  wm.open(id);
  requestAnimationFrame(() => {
    const win = windowOf(id);
    const done = () => root.classList.remove(`opening-${id}`);
    if (!win) return done();
    zoomOutline(from, win.getBoundingClientRect(), done);
  });
}

// Bring a window up: just focus it if it is showing, otherwise open or
// restore it with the outline.
export function bringUp(id: WinId, from: DOMRect | null | undefined) {
  const w = wm.get().wins[id];
  if (w.open && !w.minimized) wm.focus(id);
  else appear(id, from);
}

// Minimize: the window goes, its outline shrinks into the taskbar button.
export function vanish(id: WinId) {
  const rect = windowOf(id)?.getBoundingClientRect();
  const button = taskButtonOf(id)?.getBoundingClientRect();
  wm.minimize(id);
  zoomOutline(rect, button);
}

// Restore from the taskbar.
export function restoreFromTaskbar(id: WinId) {
  appear(id, taskButtonOf(id)?.getBoundingClientRect());
}
