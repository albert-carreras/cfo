"use client";

import { zoomCaption } from "./nav";
import { wm, type WinId } from "./wm";

function titleBarOf(id: WinId) {
  return document.querySelector(`[data-win="${id}"] .titlebar`);
}

function taskButtonOf(id: WinId) {
  return document.querySelector(`[data-task="${id}"]`);
}

// Open or restore a window with the caption flying in from `from` (an icon,
// a link, a taskbar button).
export function appear(id: WinId, from: DOMRect | null | undefined) {
  wm.open(id);
  if (!from) return;
  requestAnimationFrame(() => {
    const win = document.querySelector<HTMLElement>(`[data-win="${id}"]`);
    const bar = titleBarOf(id);
    if (!win || !bar) return;
    win.style.visibility = "hidden";
    zoomCaption(from, bar.getBoundingClientRect(), wm.get().wins[id].title, () => {
      win.style.visibility = "";
    });
  });
}

// Minimize with the caption flying down to the window's taskbar button.
export function vanish(id: WinId) {
  const bar = titleBarOf(id)?.getBoundingClientRect();
  const button = taskButtonOf(id)?.getBoundingClientRect();
  wm.minimize(id);
  zoomCaption(bar, button, wm.get().wins[id].title);
}

// Restore from the taskbar.
export function restoreFromTaskbar(id: WinId) {
  appear(id, taskButtonOf(id)?.getBoundingClientRect());
}
