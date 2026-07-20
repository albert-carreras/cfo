import Link from "next/link";
import type { ReactNode } from "react";
import { sparklinePoints } from "@/shared/sparkline";
import { CopyExportButton } from "./CopyExportButton";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const NAV = [
  { href: "/", label: "Picture", code: "01" },
  { href: "/data", label: "Data", code: "02" },
  { href: "/history", label: "History", code: "03" },
] as const;

export function TopBar({
  active,
  actions,
}: {
  active?: "picture" | "data" | "history";
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <Link href="/" className="system-mark" aria-label="CFO home">
        <span className="system-mark-main">CFO</span>
      </Link>
      <nav className="top-tabs" aria-label="Primary">
        {NAV.map((item) => {
          const key = item.label.toLowerCase();
          return (
            <Link
              key={item.href}
              href={item.href}
              className={classes("top-tab", active === key && "active")}
            >
              <span>{item.code}</span> {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="top-actions">{actions}</div>
    </header>
  );
}

export function SystemHeader({
  active,
  title,
  kicker,
  actions,
}: {
  active: "picture" | "data" | "history";
  title: string;
  kicker: string;
  actions?: ReactNode;
}) {
  return (
    <>
      <TopBar active={active} actions={actions} />
      <div className="system-heading">
        <div>
          <p className="microlabel">{kicker}</p>
          <h1>{title}</h1>
        </div>
        <div className="registration" aria-hidden="true">
          <i />
          <span>00</span>
        </div>
      </div>
    </>
  );
}

export function PageShell({
  children,
  narrow = false,
  className,
}: {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <main className={classes("app-shell", narrow && "app-shell-narrow", className)}>
      {children}
    </main>
  );
}

export function BrandLogo({ compact = false }: { compact?: boolean; priority?: boolean }) {
  return (
    <Link href="/" className={classes("brand-logo", compact && "compact")}>
      CFO
    </Link>
  );
}

export function Masthead({ right }: { right?: ReactNode }) {
  return <TopBar actions={right} />;
}

export function SectionHeading({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes("section-heading", className)}>
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

// The one header action set shared by every surface: download the Markdown
// brief and copy it to the clipboard. Kept identical across Picture, Data and
// History so the export affordance never depends on which page you are on.
export function ExportActions() {
  return (
    <>
      <a href="/api/export" className="button-secondary">
        Export .md
      </a>
      <CopyExportButton />
    </>
  );
}

export function Tag({ kind }: { kind: "Verified" | "Calculated" | "Judgment" }) {
  return <span className={classes("evidence-tag", kind.toLowerCase())}>{kind}</span>;
}

export function MetricReadout({
  label,
  value,
  note,
  accent = false,
  textValue = false,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  accent?: boolean;
  // Render the value as words, not money — smaller type for readouts like
  // "Holds" / "Does not hold" so they don't shout at figure size.
  textValue?: boolean;
  // Dim the value for a non-informative zero (no other assets, no debt).
  muted?: boolean;
}) {
  return (
    <div className={classes("metric-readout", accent && "accent", muted && "muted")}>
      <div className="microlabel">{label}</div>
      <div className={classes("metric-value", textValue && "metric-value-text")}>{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

// Hairline net-worth sparkline — no axes, no labels; the piso-radar `.spark`
// idiom. Server-rendered inline SVG. Renders nothing until there are at least
// two points to connect.
export function Sparkline({
  values,
  caption,
  width = 120,
  height = 28,
}: {
  values: number[];
  // Optional one-line reading of the series (e.g. "+€14k over 18 mo") so the
  // shape carries a scale without adding axes.
  caption?: ReactNode;
  width?: number;
  height?: number;
}) {
  const points = sparklinePoints(values, { width, height });
  if (!points) return null;
  return (
    <>
      <svg
        className="spark"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {caption && <div className="spark-caption">{caption}</div>}
    </>
  );
}
