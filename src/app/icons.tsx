// Windows XP icons (Microsoft's artwork, see public/xp/NOTICE.md). Decorative
// only: every use sits next to a text label, so they are hidden from
// assistive tech.

export type XpIconName =
  | "alert"
  | "briefcase"
  | "calculator"
  | "certificate"
  | "control-panel"
  | "copy"
  | "critical"
  | "event-viewer"
  | "folder"
  | "graph"
  | "history"
  | "home"
  | "information"
  | "my-computer"
  | "notepad"
  | "play"
  | "refresh"
  | "save"
  | "scheduled-tasks"
  | "success"
  | "volume"
  | "back"
  | "forward"
  | "up"
  | "go"
  | "network"
  | "network-places"
  | "media"
  | "zip"
  | "txt"
  | "xml"
  | "folder-open";

export function XpIcon({ name, className }: { name: XpIconName; className?: string }) {
  return (
    <span
      className={className ? `xp ${className}` : "xp"}
      style={{ backgroundImage: `url(/xp/${name}.png)` }}
      aria-hidden="true"
    />
  );
}
