import Link from "next/link";
import { createId } from "@paralleldrive/cuid2";
import { computeSnapshot } from "@/calc/snapshot";
import { materialChange, snapshotSummary } from "@/calc/materialChange";
import { confidence, confidenceObservation } from "@/calc/confidence";
import type { StatusLevel } from "@/calc/status";
import { loadFacts } from "@/server/facts";
import { recordCheck } from "@/server/checks";
import {
  isReviewDue,
  latestStrategicSnapshot,
  listSnapshots,
  storedSnapshotResult,
} from "@/server/snapshots";
import {
  BrandLogo,
  Card,
  Masthead,
  PageShell,
  STATUS_STYLES,
  Tag,
  formatAgo,
} from "./ui";

export const dynamic = "force-dynamic";

// The calm home (principle #8): status · data freshness · "nothing
// changed since you last checked". No numbers — full depth is one tap away on
// /detail, history on /reviews.

// The ad headline: deterministic UI copy keyed on the tested status engine's
// level — the wit lives here, never in the calculators or the model.
const STATUS_HEADLINE: Record<StatusLevel, string> = {
  stable: "Nothing to report.",
  review_soon: "Worth a look. No rush.",
  action_recommended: "A decision awaits.",
  urgent: "Now would be a good time.",
  data_stale: "We're missing a few facts.",
};

const SECTIONS = [
  {
    href: "/detail",
    no: "01",
    title: "Details",
    blurb: "Net worth, runway, tax estimate, holdings, provenance.",
  },
  {
    href: "/reviews",
    no: "02",
    title: "Reviews",
    blurb: "Strategic snapshot history and the confidence breakdown.",
  },
  {
    href: "/ask",
    no: "03",
    title: "Ask",
    blurb: "Pull-first questions over the calculators, saved to the decision journal.",
  },
  {
    href: "/manage",
    no: "04",
    title: "Your setup",
    blurb: "Accounts, properties, assumptions, planned events — the slow half.",
  },
] as const;

export default async function HomePage() {
  let bundle: Awaited<ReturnType<typeof loadFacts>> | null = null;
  let loadError: string | null = null;
  try {
    bundle = await loadFacts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError || !bundle || bundle.facts.accounts.length === 0) {
    return (
      <PageShell narrow className="py-20 text-center">
        <Masthead />
        <div className="mt-14 flex justify-center">
          <BrandLogo />
        </div>
        <h1 className="font-display mt-12 text-4xl">Your financial home</h1>
        {loadError ? (
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[var(--ink-soft)]">
            Could not reach the database. Set{" "}
            <code className="border border-[var(--hairline)] px-1">DATABASE_URL</code>, then run{" "}
            <code className="border border-[var(--hairline)] px-1">npm run db:migrate</code>.
          </p>
        ) : (
          <>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[var(--ink-soft)]">
              No data yet. Enter your opening baseline — accounts, holdings,
              properties, assumptions — and the first snapshot computes from it.
            </p>
            <p className="mt-8">
              <Link href="/setup" className="button-primary inline-block">
                Start setup →
              </Link>
            </p>
          </>
        )}
        {loadError && (
          <p className="fine-print mt-4">{loadError}</p>
        )}
      </PageShell>
    );
  }

  const { facts } = bundle;
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);

  const lastStrategic = await latestStrategicSnapshot();
  const storedStrategic = lastStrategic
    ? storedSnapshotResult(lastStrategic)
    : null;
  const lastStrategicDate = lastStrategic
    ? storedStrategic?.asOf ?? lastStrategic.asOf
    : null;
  const reviewDue = isReviewDue(lastStrategic?.computedAt ?? null, asOf);

  // Home needs status + freshness only — the decision scenarios live on the
  // stored strategic snapshot and /detail.
  const currentSnapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue,
    facts,
    withScenarios: false,
  });

  // The firewall line: daily internal updates underneath, calm surface on top.
  const mc = materialChange({
    snapshotId: currentSnapshot.snapshotId,
    previous: storedStrategic ? snapshotSummary(storedStrategic) : null,
    current: snapshotSummary(currentSnapshot),
  }).value;

  // Slow confidence: EMA over the internal daily history + today (principle #11).
  const internalHistory = await listSnapshots("internal", 400);
  const conf = confidence({
    snapshotId: currentSnapshot.snapshotId,
    observations: [
      ...internalHistory.map((row) =>
        confidenceObservation(storedSnapshotResult(row)),
      ),
      confidenceObservation(currentSnapshot),
    ],
  }).value;

  const dq = currentSnapshot.dataQuality.value;
  const st = currentSnapshot.status.value;

  // Repeat-check detection: log this look, show when the previous one was.
  const previousCheck = await recordCheck(st.status);

  const pricesAsOf = facts.prices
    .map((p) => p.asOf)
    .sort()
    .at(-1);

  // "Computed" = when the daily job last recomputed (the newest internal
  // snapshot). The strategic "Snapshot" date is frozen between monthly /
  // material-change promotions, so on its own the card looks stale even when
  // the feed ran today. This date advances every day the cron runs, so the
  // Freshness card reflects real recency, not just the last promotion.
  const lastInternal = internalHistory[0] ?? null;
  const lastComputedDate = lastInternal
    ? storedSnapshotResult(lastInternal).asOf ?? lastInternal.asOf
    : null;

  return (
    <PageShell>
      <Masthead
        right={
          <Link href="/log" className="hover:text-[var(--accent)]">
            Quick-log →
          </Link>
        }
      />

      {/* The ad: one witty headline, the deterministic label in the caption. */}
      <section className={`border-b ${STATUS_STYLES[st.status]}`}>
        <h1 className="font-display mx-auto mt-8 max-w-4xl text-center text-6xl leading-[1.02] sm:text-8xl">
          {STATUS_HEADLINE[st.status]}
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-center text-base italic leading-7 text-[var(--ink-soft)] sm:text-lg">
          {st.reason}
          <sup aria-hidden="true">†</sup>
        </p>
        {st.status === "data_stale" && (
          <p className="mx-auto mt-5 max-w-2xl text-center text-sm leading-6">
            Stale or missing: {dq.missing.join(", ")}.{" "}
            <Link href="/log" className="underline">
              Update via Quick-log
            </Link>
            .
          </p>
        )}
        <p className="fine-print mb-2 mt-12 text-center">
          {previousCheck
            ? `You last checked ${formatAgo(previousCheck.checkedAt, now)}. `
            : "First check recorded. "}
          {mc.material
            ? `Material change: ${mc.changes.map((c) => c.detail).join(" ")}`
            : `No material change${mc.comparedTo ? ` since ${mc.comparedTo}` : ""}.`}{" "}
          <Link href="/picture" className="underline hover:text-[var(--accent)]">
            Read the full picture →
          </Link>
        </p>
      </section>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {/* Slow confidence — distinct from data quality */}
        <Card className="p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] pb-3">
            <div className="eyebrow">Plan confidence</div>
            <Tag kind="Calculated" />
          </div>
          <div className="font-display mt-6 text-6xl">{conf.score}</div>
          <p className="mt-3 text-sm italic leading-6 text-[var(--ink-soft)]">
            Slow-moving, based on {conf.observations} snapshot
            {conf.observations === 1 ? "" : "s"}.
          </p>
        </Card>

        {/* Data freshness */}
        <Card className="p-6 sm:p-7">
          <div className="border-b border-[var(--hairline)] pb-3">
            <div className="eyebrow">Freshness</div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="fine-print">Snapshot</dt>
              <dd className="mt-1 tabular-nums">{lastStrategicDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="fine-print">Computed</dt>
              <dd className="mt-1 tabular-nums">{lastComputedDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="fine-print">Prices</dt>
              <dd className="mt-1 tabular-nums">{pricesAsOf ?? "—"}</dd>
            </div>
            <div>
              <dt className="fine-print">Data quality</dt>
              <dd className="mt-1">
                {dq.score}
                {st.status !== "data_stale" &&
                  dq.missing.length > 0 &&
                  ` · Missing: ${dq.missing.join(", ")}`}
              </dd>
            </div>
          </dl>
          {dq.flags.length > 0 && (
            <p className="mt-4 border-t border-[var(--hairline)] pt-4 text-xs italic leading-5 text-[var(--ink-soft)]">
              {dq.flags.join(" · ")}
            </p>
          )}
        </Card>
      </div>

      {/* Full depth — one tap away, never shoved at you */}
      <hr className="rule-strong mt-16" />
      <nav className="grid grid-cols-1 md:grid-cols-4 md:divide-x md:divide-[var(--hairline)]">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block border-b border-[var(--hairline)] px-5 py-6 no-underline transition-colors hover:bg-[var(--paper-bright)] md:px-6"
          >
            <div className="fine-print">{section.no}</div>
            <div className="font-display mt-2 flex items-baseline justify-between text-2xl">
              {section.title}
              <span
                className="font-sans text-base transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              >
                →
              </span>
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
              {section.blurb}
            </div>
          </Link>
        ))}
      </nav>

      <p className="fine-print mt-12 text-center">
        † Status is computed by a deterministic, tested engine. Every figure
        deterministic · sourced · tested — the model never originates a number.
      </p>
      <p className="font-display mt-8 text-center text-xl">
        CFO<span className="align-super text-[0.5em]">®</span>{" "}
        <span className="italic text-[var(--ink-soft)]">
          The personal financial brain.
        </span>
      </p>
    </PageShell>
  );
}
