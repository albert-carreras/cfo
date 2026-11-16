"use client";

import { XpIcon, type XpIconName } from "./icons";
import { vanish } from "./winfx";
import { useWm, wm, type WinId } from "./wm";

// An XP title bar with working buttons: drag to move, double-click to
// maximize, minimize to the taskbar, maximize/restore and close.
export function TitleBar({
  id,
  title,
  icon,
  onClose,
  onPointerDown,
  maximizable = true,
}: {
  id: WinId;
  title: string;
  icon: XpIconName;
  onClose: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  maximizable?: boolean;
}) {
  const maximized = useWm().wins[id].maximized;
  return (
    <div
      className="titlebar"
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        if (maximizable && !(event.target as Element).closest("button")) wm.toggleMax(id);
      }}
    >
      <XpIcon name={icon} className="titlebar-icon" />
      <span className="titlebar-text">{title}</span>
      <span className="titlebar-buttons">
        <button type="button" className="tb tb-min" aria-label="Minimize" title="Minimize" onClick={() => vanish(id)} />
        {maximizable && (
          <button
            type="button"
            className={maximized ? "tb tb-restore" : "tb tb-max"}
            aria-label={maximized ? "Restore Down" : "Maximize"}
            title={maximized ? "Restore Down" : "Maximize"}
            onClick={() => wm.toggleMax(id)}
          />
        )}
        <button type="button" className="tb tb-close" aria-label="Close" title="Close" onClick={onClose} />
      </span>
    </div>
  );
}
