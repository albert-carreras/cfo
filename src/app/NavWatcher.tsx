"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { mainHistory, noteSubmit, rememberRect, requestSide, setBusy } from "./nav";
import { isSideRoute } from "./routes";
import { appear } from "./winfx";
import { wm } from "./wm";

// Watches navigation for the desktop: the hourglass while a page loads, the
// main window's own history, which window a link opens in, and where a click
// or a form came from.
export function NavWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const first = useRef(true);
  const reopen = useRef<string | null>(null);

  useEffect(() => {
    const url = search ? `${pathname}?${search}` : pathname;
    if (first.current) {
      first.current = false;
      if (isSideRoute(pathname)) {
        // Loaded directly (a reload, a bookmark): put the overview in the main
        // window and open this page in its own window, as from inside the app.
        reopen.current = url;
        setBusy(true);
        router.replace("/");
        return;
      }
    }
    if (isSideRoute(pathname)) {
      setBusy(false);
      return;
    }
    mainHistory.visit(url);
    if (reopen.current && pathname === "/") {
      const target = reopen.current;
      reopen.current = null;
      requestSide(target.split("?")[0]);
      router.push(target);
      return;
    }
    setBusy(false);
  }, [pathname, search, router]);

  useEffect(() => {
    // Capture phase: before the link starts navigating.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      // Desktop icons handle their own clicks (select, then open).
      if (!link || link.target || link.hasAttribute("download") || link.closest(".desk-icon")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      const rect = link.getBoundingClientRect();
      if (isSideRoute(url.pathname)) {
        rememberRect(rect);
        requestSide(url.pathname);
      } else {
        const main = wm.get().wins.main;
        if (!main.open || main.minimized) appear("main", rect);
        else wm.focus("main");
      }
      if (url.pathname + url.search !== window.location.pathname + window.location.search) setBusy(true);
    };
    const onSubmit = (event: SubmitEvent) => {
      const win = (event.target as Element | null)?.closest?.("[data-win]");
      noteSubmit(win?.getAttribute("data-win") ?? null);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
