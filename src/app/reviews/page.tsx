import Link from "next/link";
import { createId } from "@paralleldrive/cuid2";
import { renderStatementParts } from "@/ai/schema";
import type {
  MetricEntry,
  ReviewContext,
  ReviewReport,
  StatementLabel,
} from "@/ai/types";
import { computeSnapshot } from "@/calc/snapshot";
import { confidence, confidenceObservation } from "@/calc/confidence";
import type { DecisionOutcomesValue } from "@/calc/decisionOutcome";
import type { MaterialChangeValue } from "@/calc/materialChange";
import { dec, formatEURCoarse, formatYearsCoarse } from "@/calc/money";
import type { StatusLevel } from "@/calc/status";
import type { CalcResult } from "@/calc/types";
import { loadFacts } from "@/server/facts";
import { listReviews, type ReviewRow } from "@/server/reviews";
import {
  isReviewDue,
  listSnapshots,
  storedSnapshotResult,
} from "@/server/snapshots";
import { Amount, AmountsProvider, AmountsToggle } from "../amounts";
import {
  BrandLogo,
  Card,
  PageHeader,
  PageShell,
  SectionHeading,
  STATUS_DOT,
  Tag,
} from "../ui";

export const dynamic = "force-dynamic";

// Reviews: the monthly analyst's reports (reassurance digest,
// regulatory watch, tax-table verification) on top of the
// deterministic history — the strategic snapshots and the slow confidence
// score's breakdown.

const TAG_BY_LABEL: Record<StatementLabel, "Verified" | "Calculated" | "Judgment"> = {
  verified: "Verified",
  calculated: "Calculated",
  judgment: "Judgment",
};

function StatementText({
  text,
  metrics,
}: {
  text: string;
  metrics: MetricEntry[];
}) {
  return (
    <>
      {renderStatementParts(text, metrics).map((part, i) =>
        part.kind === "metric" ? (
          <Amount key={i}>{part.value}</Amount>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

// Signed coarse delta — a movement, not a balance.
function signedEURCoarse(value: string): string {
  return dec(value).isNegative()
    ? formatEURCoarse(value)
    : `+${formatEURCoarse(value)}`;
}

// One measured decision outcome — purely Calculated: the decision's
// pinned summary vs the snapshot it was re-measured against.
function OutcomeLine({
  outcome,
}: {
  outcome: DecisionOutcomesValue["outcomes"][number];
}) {
  return (
    <li className="text-sm text-[var(--ink-soft)]">
      <span className="font-semibold text-[var(--ink)]">{outcome.question}</span>
      {` — decided ${outcome.decidedOn}`}
      {outcome.chosenAction
        ? ` · chosen: ${outcome.chosenAction}`
        : outcome.reviewed
          ? " · reviewed"
          : " · not yet reviewed"}
      <span className="block">
        Δ net worth since:{" "}
        <Amount>{signedEURCoarse(outcome.netWorthDeltaEUR)}</Amount>
        {outcome.netWorthDeltaPct !== null &&
          ` (${dec(outcome.netWorthDeltaPct).isNegative() ? "" : "+"}${outcome.netWorthDeltaPct}%)`}
        {outcome.runwayThenMonths !== null &&
          outcome.runwayNowMonths !== null &&
          ` · runway ${outcome.runwayThenMonths} → ${outcome.runwayNowMonths} months`}
        {` · status ${outcome.statusThen} → ${outcome.statusNow}`}
      </span>
    </li>
  );
}

function MonthlyReview({ review }: { review: ReviewRow }) {
  const report = review.report as ReviewReport | null;
  const context = review.context as ReviewContext | null;
  const mc = review.materialChange as MaterialChangeValue;
  // Accountability columns — null on rows written before the accountability loop.
  const outcomes = review.outcomes as CalcResult<DecisionOutcomesValue> | null;
  const firedTriggers = review.firedTriggers as
    | { id: string; label: string }[]
    | null;

  return (
    <article className="card mt-4 p-5 sm:p-6">
      <p className="fine-print flex flex-wrap items-center gap-2">
        <span className="font-display text-base normal-case tracking-normal text-[var(--ink)]">
          {review.month}
        </span>
        <span aria-hidden="true">·</span>
        {review.scope === "full" ? (
          <>analyst review · {review.model}</>
        ) : (
          <>deterministic only</>
        )}
        {report?.suggestsReview && (
          <span className="ml-2 border border-[#32506e] px-1.5 py-0.5 text-[#32506e]">
            review soon
          </span>
        )}
      </p>

      {/* The deterministic floor — present in every review, full or not. */}
      <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">
        {mc.material
          ? mc.changes.map((c) => c.detail).join(" ")
          : `No material change${mc.comparedTo ? ` since ${mc.comparedTo}` : ""}.`}
        <span className="ml-2 inline-flex align-middle">
          <Tag kind="Calculated" />
        </span>
      </p>
      {review.scope === "deterministic" && (
        <p className="fine-print mt-1">
          The analyst did not run ({review.llmError}) — tax tables on record:{" "}
          {review.taxTableVersion}.
        </p>
      )}

      {/* The trigger record: silence is informative, on the record. */}
      {firedTriggers !== null &&
        (firedTriggers.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            No triggers fired this month — nothing to recommend.
            <span className="ml-2 inline-flex align-middle">
              <Tag kind="Calculated" />
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Triggers fired: {firedTriggers.map((t) => t.label).join(" · ")}
            <span className="ml-2 inline-flex align-middle">
              <Tag kind="Calculated" />
            </span>
          </p>
        ))}

      {/* Decisions revisited — the deterministic deltas, present in
          every review that had journaled decisions, full or not. */}
      {outcomes && outcomes.value.outcomes.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow">
            Decisions revisited
            <span className="ml-2 inline-flex align-middle">
              <Tag kind="Calculated" />
            </span>
          </p>
          <ul className="mt-1 space-y-2">
            {outcomes.value.outcomes.map((outcome) => (
              <OutcomeLine key={outcome.decisionId} outcome={outcome} />
            ))}
          </ul>
          {report && context && report.decisionsRevisited?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {report.decisionsRevisited.map((statement, i) => (
                <li key={i} className="text-sm italic text-[var(--ink-soft)]">
                  <StatementText
                    text={statement.text}
                    metrics={context.metrics}
                  />
                  <span className="ml-2 inline-flex align-middle">
                    <Tag kind={TAG_BY_LABEL[statement.label]} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="fine-print mt-1">
            {outcomes.source} · {outcomes.version} · measured against the{" "}
            {outcomes.value.comparedAsOf} snapshot
          </p>
        </div>
      )}

      {report && context && (
        <>
          <ul className="mt-5 space-y-3 border-t border-[var(--hairline)] pt-5">
            {report.digest.map((statement, i) => (
              <li key={i} className="text-sm">
                <span
                  className={
                    statement.label === "judgment" ? "italic text-[var(--ink-soft)]" : "text-[var(--ink)]"
                  }
                >
                  <StatementText
                    text={statement.text}
                    metrics={context.metrics}
                  />
                </span>
                <span className="ml-2 inline-flex align-middle">
                  <Tag kind={TAG_BY_LABEL[statement.label]} />
                </span>
                {statement.citations.length > 0 && (
                  <p className="fine-print mt-0.5">
                    {statement.citations
                      .map((c) => context.citationLabels[c] ?? c)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {report.findings.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow">
                Regulatory watch
                <span className="ml-2 inline-flex align-middle">
                  <Tag kind="Judgment" />
                </span>
              </p>
              <ul className="mt-1 space-y-2">
                {report.findings.map((finding, i) => (
                  <li key={i} className="text-sm text-[var(--ink-soft)]">
                    <span className="font-semibold text-[var(--ink)]">
                      {finding.topic}
                    </span>
                    {finding.status === "announced" && (
                      <span className="font-label ml-1.5 border border-[#8a6a1f] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-[#8a6a1f]">
                        announced
                        {finding.effectiveFrom && ` · from ${finding.effectiveFrom}`}
                      </span>
                    )}
                    {" — "}
                    {finding.summary}
                    <span className="ml-1 text-xs">
                      {finding.sources.map((url, j) => (
                        <a
                          key={j}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mr-1 text-[var(--ink-faint)] underline"
                        >
                          source
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-sm text-[var(--ink-soft)]">
            <span className="fine-print">Tax tables</span>{" "}
            {review.taxTableVersion} —{" "}
            {report.taxTables.verdict === "current"
              ? "verified current"
              : report.taxTables.verdict === "drifted"
                ? `drifted; proposed bump: ${report.taxTables.proposedVersion ?? "(none)"} — a proposal, never auto-applied`
                : "not verified against current law"}
            .{report.taxTables.notes && ` ${report.taxTables.notes}`}
            <span className="ml-2 inline-flex align-middle">
              <Tag kind="Judgment" />
            </span>
            {report.taxTables.sources.map((url, j) => (
              <a
                key={j}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-xs text-[var(--ink-faint)] underline"
              >
                source
              </a>
            ))}
          </p>

          {report.recommendation && review.decisionId && (
            <p className="notice notice-orange mt-3">
              <StatementText
                text={report.recommendation.text}
                metrics={context.metrics}
              />
              <Tag kind="Judgment" />
              <Link
                href={`/ask?d=${review.decisionId}`}
                className="ml-2 text-xs underline"
              >
                in the decision journal →
              </Link>
            </p>
          )}
        </>
      )}
    </article>
  );
}

export default async function ReviewsPage() {
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
        <div className="mb-4 flex justify-center">
          <BrandLogo compact />
        </div>
        <h1 className="font-display mt-8 text-4xl">Reviews</h1>
        <p className="mt-4 text-[var(--ink-soft)]">
          {loadError ? "Could not reach the database." : "No data yet."}
        </p>
        <Link href="/" className="button-secondary mt-7">
          ← Home
        </Link>
      </PageShell>
    );
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const [strategicRows, internalHistory, monthlyReviews] = await Promise.all([
    listSnapshots("strategic", 60),
    listSnapshots("internal", 400),
    listReviews(12),
  ]);
  const strategic = strategicRows.map((row) => ({
    row,
    snap: storedSnapshotResult(row),
  }));
  const reviewDue = isReviewDue(
    strategicRows[0]?.computedAt ?? null,
    asOf,
  );

  // Same confidence the home shows, with its composition laid out. The live
  // track record (each journaled decision re-measured against today) now lives
  // on /ask, beside the answers — what the monthly review still pins per row.
  const currentSnapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue,
    facts: bundle.facts,
  });

  const conf = confidence({
    snapshotId: currentSnapshot.snapshotId,
    observations: [
      ...internalHistory.map((row) =>
        confidenceObservation(storedSnapshotResult(row)),
      ),
      confidenceObservation(currentSnapshot),
    ],
  });

  // Newest-first list; delta computed against the NEXT row (the previous
  // strategic snapshot in time).
  const deltaPct = (i: number): string | null => {
    const prev = strategic[i + 1]?.snap.netWorth.value.totalEUR;
    const curr = strategic[i].snap.netWorth.value.totalEUR;
    if (prev === undefined || dec(prev).isZero()) return null;
    return dec(curr).minus(dec(prev)).dividedBy(dec(prev).abs()).times(100).toFixed(1);
  };

  return (
    <AmountsProvider>
      <PageShell>
        <PageHeader title="Reviews" actions={<AmountsToggle />} />

        {reviewDue && (
          <p className="notice notice-sky mb-8">
            A scheduled review is due — the last strategic snapshot is more than
            a month old.
          </p>
        )}

        {/* Monthly reviews */}
        <section>
          <SectionHeading>
            Monthly reviews
            <Tag kind="Judgment" />
          </SectionHeading>
          {monthlyReviews.length === 0 ? (
            <div className="empty-state">
              <p className="font-display text-xl">
                No monthly review yet.
              </p>
              <p className="mt-2 text-sm italic">
                The scheduled job writes the first one on the 1st.
              </p>
            </div>
          ) : (
            monthlyReviews.map((review) => (
              <MonthlyReview key={review.id} review={review} />
            ))
          )}
        </section>

        {/* Confidence breakdown */}
        <section className="mt-14">
          <SectionHeading>
            Plan confidence
            <Tag kind="Calculated" />
          </SectionHeading>
          <Card className="grid overflow-hidden lg:grid-cols-[0.72fr_1.28fr]">
            <div className="bg-[var(--ink)] p-6 text-[var(--paper-bright)] sm:p-8">
              <div className="eyebrow !text-[#b9ad94]">Slow-moving score</div>
              <div className="font-display mt-5 text-8xl">
                {conf.value.score}
              </div>
              <p className="mt-4 text-sm italic leading-6 text-[#b9ad94]">
                Today&apos;s unsmoothed composite: {conf.value.rawScore}
              </p>
            </div>
            <div className="p-6 sm:p-8">
          <p className="text-sm leading-6 text-[var(--ink-soft)]">
            Slow-moving (EMA over {conf.value.observations} snapshot
            {conf.value.observations === 1 ? "" : "s"}
            {conf.value.firstObservedAt &&
              ` since ${conf.value.firstObservedAt}`}
            ).
          </p>
          <div className="mt-6 space-y-5">
              {conf.value.components.map((c) => (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-[var(--ink-soft)]">{c.label}</span>
                    <span className="tabular-nums">
                      <span className="mr-3 text-[var(--ink-faint)]">
                    {Math.round(c.weight * 100)}%
                      </span>
                      <span className="font-semibold">{c.score}</span>
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden border border-[var(--ink)] bg-[var(--paper-bright)]">
                    <div
                      className="h-full bg-[var(--ink)]"
                      style={{ width: `${c.score}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
          <p className="fine-print mt-7 border-t border-[var(--hairline)] pt-4">
            {conf.source} · {conf.version} · answers &ldquo;is the plan
            sound?&rdquo; — data freshness is scored separately (data quality).
          </p>
            </div>
          </Card>
        </section>

        {/* Strategic snapshot history */}
        <section className="mt-14">
          <SectionHeading>
            Strategic snapshots
            <Tag kind="Calculated" />
          </SectionHeading>
          {strategic.length === 0 ? (
            <div className="empty-state text-sm">
              No strategic snapshot yet — the daily job promotes the first one.
            </div>
          ) : (
            <div className="table-shell">
            <table className="data-table min-w-[48rem]">
              <thead className="text-left">
                <tr>
                  <th>As of</th>
                  <th>Status</th>
                  <th className="text-right">Net worth</th>
                  <th className="text-right">Δ vs prev</th>
                  <th className="text-right">Runway</th>
                  <th className="text-right">Tax tables</th>
                </tr>
              </thead>
              <tbody>
                {strategic.map(({ row, snap }, i) => {
                  const d = deltaPct(i);
                  return (
                    <tr key={row.id}>
                      <td>{snap.asOf}</td>
                      <td>
                        <span
                          className={`mr-1.5 inline-block h-2 w-2 ${STATUS_DOT[row.status as StatusLevel] ?? "bg-[var(--hairline)]"}`}
                        />
                        {snap.status.value.label}
                      </td>
                      <td className="text-right">
                        <Amount>
                          {formatEURCoarse(snap.netWorth.value.totalEUR)}
                        </Amount>
                      </td>
                      <td className="text-right text-[var(--ink-soft)]">
                        {d === null ? "—" : `${Number(d) > 0 ? "+" : ""}${d}%`}
                      </td>
                      <td className="text-right text-[var(--ink-soft)]">
                        {snap.fire.value.runwayYears === null
                          ? "—"
                          : formatYearsCoarse(snap.fire.value.runwayYears)}
                      </td>
                      <td className="text-right font-mono text-xs text-[var(--ink-faint)]">
                        {snap.taxES.version}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </PageShell>
    </AmountsProvider>
  );
}
