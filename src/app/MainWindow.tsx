"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { describe } from "./routes";
import { TitleBar } from "./TitleBar";
import { useWindowDrag } from "./useWindowDrag";
import { WindowChrome } from "./WindowChrome";
import { useWm, wm, zIndexOf } from "./wm";

// The app's main window. One fixed size whatever the page; the page inside
// scrolls. It can be moved, maximized, minimized to the taskbar or closed
// (opening any page brings it back).
export function MainWindow({ children, visits }: { children: ReactNode; visits: number | null }) {
  const s = useWm();
  const w = s.wins.main;
  // The page this window shows (not a page open in another window).
  const path = `/${useSelectedLayoutSegments().join("/")}`;
  const title = `CFO ${new Date().getFullYear()} - ${describe(path).at(-1)}`;
  const drag = useWindowDrag(!w.maximized);
  const moved = drag.offset.x !== 0 || drag.offset.y !== 0;

  useEffect(() => {
    wm.set("main", { title });
  }, [title]);

  // On phones the whole window scrolls; start each page at the top.
  useEffect(() => {
    document.querySelector('[data-win="main"]')?.scrollTo(0, 0);
  }, [path]);

  const classes = ["window", "main-window"];
  if (w.maximized) classes.push("is-max");
  if (s.focused === "main") classes.push("is-active");

  return (
    <div
      data-win="main"
      className={classes.join(" ")}
      hidden={!w.open || w.minimized}
      style={{
        zIndex: zIndexOf(s, "main"),
        transform: moved && !w.maximized ? `translate(${drag.offset.x}px, ${drag.offset.y}px)` : undefined,
      }}
      onPointerDownCapture={() => wm.focus("main")}
    >
      <header className="win-head">
        <TitleBar id="main" title={title} icon="briefcase" onClose={() => wm.close("main")} onPointerDown={drag.onPointerDown} />
        <WindowChrome path={path} visits={visits} />
      </header>
      {children}
    </div>
  );
}
