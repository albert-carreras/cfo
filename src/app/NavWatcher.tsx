"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { mainHistory, noteSubmit, rememberRect, setBusy } from "./nav";
import { isSideRoute } from "./routes";
import { wm } from "./wm";

// Watches navigation for the desktop: the hourglass while a page loads, the
// main window's own history, bringing the right window forward, and where a
// click or a form came from.
export function NavWatcher() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const first = useRef(true);

  useEffect(() => {
    setBusy(false);
    // Loaded directly, any page fills the main window; afterwards the
    // window-of-their-own pages open beside it.
    if (first.current || !isSideRoute(pathname)) mainHistory.visit(search ? `${pathname}?${search}` : pathname);
    first.current = false;
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      const here = window.location.pathname + window.location.search;
      const there = url.pathname + url.search;
      rememberRect(link.getBoundingClientRect());
      if (isSideRoute(url.pathname)) {
        // Same address as the window already holds: just bring it back.
        if (there === here) wm.open("side");
      } else {
        wm.open("main");
      }
      if (there !== here) setBusy(true);
    };
    const onSubmit = (event: SubmitEvent) => {
      const win = (event.target as Element | null)?.closest?.("[data-win]");
      noteSubmit(win?.getAttribute("data-win") ?? null);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
