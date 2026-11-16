"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

const TASKBAR = 38;

// Drag a window by its title bar, keeping the title bar on screen. Off on
// phones, where windows fill the screen.
export function useWindowDrag(enabled: boolean) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!enabled || event.button !== 0) return;
    if ((event.target as Element).closest("button, a")) return;
    if (window.matchMedia("(max-width: 640px)").matches) return;
    const bar = event.currentTarget;
    const win = bar.closest("[data-win]") as HTMLElement | null;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    const maxBottom = window.innerHeight - TASKBAR - 30;
    bar.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = Math.max(100 - rect.right, Math.min(e.clientX - start.x, window.innerWidth - 100 - rect.left));
      const dy = Math.max(-rect.top, Math.min(e.clientY - start.y, maxBottom - rect.top));
      setOffset({ x: start.ox + dx, y: start.oy + dy });
    };
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }

  return { offset, onPointerDown };
}
