import Link from "next/link";
import type { ReactNode } from "react";
import type { AttentionTarget } from "@/calc/attention";
import { ageLabel, daysBetween, formatDate } from "@/calc/dates";
import { dec, formatEUR, formatEURWhole, formatUnits } from "@/calc/money";
import { sparklinePoints } from "@/shared/sparkline";
import { CopyBrief } from "./CopyBrief";

export const eur = (value: string | number | null | undefined) =>
  value == null ? "—" : formatEURWhole(value);
export const unitsText = formatUnits;
// A unit price keeps its cents.
export const priceText = (value: string | null | undefined) => (value == null ? "—" : formatEUR(value));
export { formatDate };

export function signedEur(value: string | number) {
  const d = dec(value);
  if (d.isZero()) return "±€0";
  return `${d.isPositive() ? "+" : "−"}${formatEURWhole(d.abs())}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/change", label: "Update" },
  { href: "/activity", label: "Activity" },
] as const;

export function Header({ active }: { active?: (typeof NAV)[number]["href"] }) {
  return (
    <header className="header">
      <Link href="/" className="brand">
        CFO
      </Link>
      <nav className="nav" aria-label="Main">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <CopyBrief />
        <a href="/api/export" download className="btn btn-small">
          .md
        </a>
      </div>
    </header>
  );
}

export function Done({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="alert alert-good">{message}.</p>;
}

// "confirmed 3 months ago", amber once past the freshness limit.
export function Confirmed({
  date,
  limitDays,
  asOf,
  bare = false,
}: {
  date: string;
  limitDays: number;
  asOf: string;
  // Just "3 months ago", for places already labelled.
  bare?: boolean;
}) {
  const days = daysBetween(date, asOf);
  const when = days <= 0 ? "today" : `${ageLabel(days)} ago`;
  return <span className={days > limitDays ? "stale" : undefined}>{bare ? when : `confirmed ${when}`}</span>;
}

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

export function NetWorthChart({ points }: { points: { asOf: string; totalEUR: number }[] }) {
  const line = sparklinePoints(
    points.map((p) => p.totalEUR),
    { width: 600, height: 72, pad: 3 },
  );
  if (!line || points.length < 2) return null;
  const first = points[0];
  const last = points.at(-1)!;
  const area = `3,72 ${line} 597,72`;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox="0 0 600 72" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={area} fill="var(--accent)" opacity="0.08" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="chart-caption">
        <span>{formatDate(first.asOf)}</span>
        <span>
          {signedEur(last.totalEUR - first.totalEUR)} over the period
        </span>
      </figcaption>
    </figure>
  );
}

export function targetHref(target: AttentionTarget): string {
  switch (target.kind) {
    case "values":
      return "/change?do=values";
    case "item":
      return `/item/${target.itemType}/${target.id}`;
    case "tax":
      return "/tax";
    case "plans":
      return "/plans";
    case "inputs":
      return "/inputs";
  }
}
