import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusLevel } from "@/calc/status";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

// The wordmark is typeset, not an image — Garamond, light, sentence case.
export function BrandLogo({
  compact = false,
}: {
  compact?: boolean;
  priority?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="CFO home"
      className="block shrink-0 no-underline"
    >
      <span
        className={classes(
          "font-display block leading-none",
          compact ? "text-3xl" : "text-5xl sm:text-6xl",
        )}
      >
        CFO
        <span className="align-super text-[0.4em] tracking-normal">®</span>
      </span>
      {!compact && (
        <span className="mt-3 block text-sm italic leading-5 text-[var(--ink-soft)]">
          The personal financial brain.
        </span>
      )}
    </Link>
  );
}

export function Masthead({ right }: { right?: ReactNode }) {
  return (
    <div className="masthead-line">
      <span>CFO<span className="align-super text-[0.5em]">®</span> The personal financial brain</span>
      {right}
    </div>
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
    <main
      className={classes(
        "app-shell",
        narrow && "app-shell-narrow",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <Masthead />
      <div className="page-header-bar">
        <div className="min-w-0">
          <Link href="/" className="back-link">
            <span aria-hidden="true">←</span> Home
          </Link>
          <h1 className="page-title">{title}</h1>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={classes(
        "card",
        interactive && "card-interactive",
        className,
      )}
    >
      {children}
    </div>
  );
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

// Restrained print color: text + border only, no loud fills.
export const STATUS_STYLES: Record<StatusLevel, string> = {
  data_stale: "border-[#8a6a1f] text-[#5a4310]",
  urgent: "border-[#8e2f22] text-[#6b2014]",
  action_recommended: "border-[#8e4f1d] text-[#5e3210]",
  review_soon: "border-[#32506e] text-[#243a50]",
  stable: "border-[#221d15] text-[#221d15]",
};

export const STATUS_DOT: Record<StatusLevel, string> = {
  data_stale: "bg-[#8a6a1f]",
  urgent: "bg-[#8e2f22]",
  action_recommended: "bg-[#8e4f1d]",
  review_soon: "bg-[#32506e]",
  stable: "bg-[#4a5e2e]",
};

// Spec-sheet provenance marks — tiny tracked Helvetica, one hairline.
export function Tag({ kind }: { kind: "Verified" | "Calculated" | "Judgment" }) {
  const cls =
    kind === "Verified"
      ? "border-[#221d15] text-[#221d15]"
      : kind === "Calculated"
        ? "border-[#32506e] text-[#32506e]"
        : "border-[#8e4f1d] text-[#8e4f1d]";
  return (
    <span
      className={`font-label inline-flex border px-1.5 py-0.5 text-[8px] font-medium uppercase leading-none tracking-[0.18em] ${cls}`}
    >
      {kind}
    </span>
  );
}

export function formatAgo(then: Date, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  return `on ${then.toISOString().slice(0, 10)}`;
}
