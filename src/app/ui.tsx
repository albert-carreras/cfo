import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { AttentionTarget } from "@/calc/attention";
import { ageLabel, daysBetween, formatDate } from "@/calc/dates";
import { dec, formatEUR, formatEURWhole, formatUnits } from "@/calc/money";
import { sparklinePoints } from "@/shared/sparkline";
import { CopyBrief } from "./CopyBrief";
import { XpIcon, type XpIconName } from "./icons";

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
  { href: "/", label: "Overview", icon: "home" },
  { href: "/change", label: "Something happened", icon: "play" },
  { href: "/change?do=values", label: "Balances", icon: "refresh" },
  { href: "/activity", label: "Activity", icon: "history" },
] as const satisfies readonly { href: string; label: string; icon: XpIconName }[];

type ActiveNav = "/" | "/change" | "/activity";

export type HeaderStat = { value: string; label: string; href?: string; tone?: "warn" | "bad" };

const TAGLINE = "CFO *** Every number verified or calculated *** No advice, no guesses ***";

// The player window every page sits in: title bar, LCD with a scrolling line
// and small readouts, and the button row that doubles as the main navigation.
export function Header({
  active,
  marquee = TAGLINE,
  stats,
}: {
  active?: ActiveNav;
  marquee?: string;
  stats?: HeaderStat[];
}) {
  const title = NAV.find((item) => item.href === active)?.label;
  return (
    <header className="wa-main">
      <div className="wa-title">
        <XpIcon name="briefcase" className="wa-title-icon" />
        <span className="wa-ribs" aria-hidden="true" />
        <span className="wa-title-text">{title ? `CFO - ${title}` : "CFO"}</span>
        <span className="wa-ribs" aria-hidden="true" />
        <span className="wa-title-buttons" aria-hidden="true">
          <span className="wa-tb wa-tb-min" />
          <span className="wa-tb wa-tb-shade" />
          <span className="wa-tb wa-tb-close" />
        </span>
      </div>
      <div className="wa-deck">
        <div className="wa-lcd">
          <div className="wa-lcd-top">
            <span className="wa-play" aria-hidden="true" />
            <span>CFO</span>
          </div>
          {/* Decorative visualizer. Not data. */}
          <div className="wa-vis" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </div>
        </div>
        <div className="wa-info">
          <div className="wa-marquee" style={{ "--chars": marquee.length } as CSSProperties}>
            <div className="wa-marquee-track">
              <span>{marquee}</span>
              <span aria-hidden="true">{marquee}</span>
            </div>
          </div>
          {stats && stats.length > 0 && (
            <div className="wa-stats">
              {stats.map((stat) => {
                const body = (
                  <>
                    <span className={`wa-stat-value${stat.tone ? ` ${stat.tone}` : ""}`}>{stat.value}</span>
                    <span className="wa-stat-label">{stat.label}</span>
                  </>
                );
                return stat.href ? (
                  <Link key={stat.label} href={stat.href} className="wa-stat">
                    {body}
                  </Link>
                ) : (
                  <span key={stat.label} className="wa-stat">
                    {body}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <nav className="wa-transport" aria-label="Main">
        <div className="wa-buttons">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="wa-btn"
              aria-current={active === item.href ? "page" : undefined}
            >
              <XpIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="wa-buttons wa-tools">
          <CopyBrief />
          <a href="/api/export" download className="wa-btn">
            <XpIcon name="save" />
            <span>.md</span>
          </a>
        </div>
      </nav>
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
  return <span className={isStale(date, limitDays, asOf) ? "stale" : undefined}>{bare ? when : `confirmed ${when}`}</span>;
}

// Past its freshness limit: the same test the "confirmed … ago" text uses.
export function isStale(date: string, limitDays: number, asOf: string) {
  return daysBetween(date, asOf) > limitDays;
}

export function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "info" | "off"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
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
        <polygon points={area} fill="var(--lcd)" opacity="0.14" />
        <polyline
          className="chart-line"
          points={line}
          fill="none"
          stroke="var(--lcd)"
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
