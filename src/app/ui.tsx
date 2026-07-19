import Link from "next/link";
import type { ReactNode } from "react";

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
        <span className="system-mark-jp">財務</span>
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
      CFO<span>財務</span>
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

export function Tag({ kind }: { kind: "Verified" | "Calculated" | "Judgment" }) {
  return <span className={classes("evidence-tag", kind.toLowerCase())}>{kind}</span>;
}

export function MetricReadout({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={classes("metric-readout", accent && "accent")}>
      <div className="microlabel">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}
