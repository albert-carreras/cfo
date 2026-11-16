"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { XpIconName } from "./icons";
import { currentSideRequest, mainHistory, recentSubmitIn, takeRect, useSideRequest } from "./nav";
import { isSideRoute } from "./routes";
import { TitleBar } from "./TitleBar";
import { useWindowDrag } from "./useWindowDrag";
import { bringUp } from "./winfx";
import { useWm, wm, zIndexOf } from "./wm";

// A second window over the main one, for a page opened from inside the app:
// an item, Tax, Plans or Inputs. It stays open while the main window moves on.
export function SideWindow({
  route,
  title,
  icon,
  children,
}: {
  route: string;
  title: string;
  icon: XpIconName;
  children: ReactNode;
}) {
  const s = useWm();
  const w = s.wins.side;
  const pathname = usePathname();
  const router = useRouter();
  const request = useSideRequest();
  const handled = useRef(request.n);
  const drag = useWindowDrag(!w.maximized);
  const moved = drag.offset.x !== 0 || drag.offset.y !== 0;
  const fullTitle = `CFO - ${title}`;

  // A new page for this window: show it, growing from what was clicked.
  useEffect(() => {
    handled.current = currentSideRequest().n;
    wm.set("side", { title: fullTitle, icon });
    bringUp("side", takeRect());
  }, [route, fullTitle, icon]);

  // Asked again for the page this window already holds (closed or minimized
  // since): the route has not changed, so only the request brings it back.
  useEffect(() => {
    if (request.n === handled.current) return;
    handled.current = request.n;
    if (request.path !== route) return;
    wm.set("side", { title: fullTitle, icon });
    bringUp("side", takeRect());
  }, [request, route, fullTitle, icon]);

  useEffect(() => () => wm.close("side"), []);

  // A form sent from here that lands on a main-window page (closing the thing
  // this window showed, say) closes the window too.
  useEffect(() => {
    if (!isSideRoute(pathname) && recentSubmitIn("side")) wm.close("side");
  }, [pathname]);

  if (!w.open) return null;

  const close = () => {
    wm.close("side");
    // Put the address back to the main window's page.
    router.replace(mainHistory.current(), { scroll: false });
  };

  const classes = ["window", "side-window"];
  if (w.maximized) classes.push("is-max");
  if (s.focused === "side") classes.push("is-active");

  return (
    <div
      data-win="side"
      className={classes.join(" ")}
      hidden={w.minimized}
      style={{
        zIndex: zIndexOf(s, "side"),
        transform: moved && !w.maximized ? `translate(${drag.offset.x}px, ${drag.offset.y}px)` : undefined,
      }}
      onPointerDownCapture={() => wm.focus("side")}
    >
      <TitleBar id="side" title={fullTitle} icon={icon} onClose={close} onPointerDown={drag.onPointerDown} />
      {children}
    </div>
  );
}
