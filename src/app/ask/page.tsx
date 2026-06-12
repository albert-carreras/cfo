import Link from "next/link";
import { MANUAL_REVIEW_SENTENCE } from "@/ai/manualReview";
import { renderStatementText } from "@/ai/schema";
import type { AskAnswer, AskContext, StatementLabel } from "@/ai/types";
import type { AskFailure } from "@/server/ask";
import type { DecisionOutcome } from "@/calc/decisionOutcome";
import { dec, formatEURCoarse } from "@/calc/money";
import { getDecision, listDecisions, type DecisionRow } from "@/server/decisions";
import { getServerEnv } from "@/server/env";
import { liveTrackRecord } from "@/server/trackRecord";
import {
  Card,
  PageHeader,
  PageShell,
  SectionHeading,
  Tag,
} from "../ui";
import { submitMarkReviewed, submitQuestion } from "./actions";
import { SubmitButton } from "./SubmitButton";

export const dynamic = "force-dynamic";

// Ask: the pull-first voice. Questions go out as calculator JSON
// only; answers come back as labelled statements whose figures are rendered
// server-side from the deterministic metrics — and every Q&A lands in the
// decision journal below, each row carrying its live track record:
// what happened to net worth, runway and status since it was decided. /reviews
// stays reserved for the monthly analyst.

// Signed coarse delta — a movement, not a balance.
function signedEURCoarse(value: string): string {
  return dec(value).isNegative()
    ? formatEURCoarse(value)
    : `+${formatEURCoarse(value)}`;
}

// The decision's outcome since it was made — purely Calculated arithmetic over
// two snapshot summaries the user can already see (Δ since reflects everything,
// not the decision alone).
function OutcomeLine({ outcome }: { outcome: DecisionOutcome }) {
  return (
    <p className="fine-print mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>
        Δ net worth since {signedEURCoarse(outcome.netWorthDeltaEUR)}
        {outcome.netWorthDeltaPct !== null &&
          ` (${dec(outcome.netWorthDeltaPct).isNegative() ? "" : "+"}${outcome.netWorthDeltaPct}%)`}
      </span>
      {outcome.runwayThenMonths !== null &&
        outcome.runwayNowMonths !== null && (
          <span>
            runway {outcome.runwayThenMonths} → {outcome.runwayNowMonths} mo
          </span>
        )}
      <span>
        status{" "}
        {outcome.statusThen === outcome.statusNow
          ? outcome.statusNow
          : `${outcome.statusThen} → ${outcome.statusNow}`}
      </span>
    </p>
  );
}

const TAG_BY_LABEL: Record<StatementLabel, "Verified" | "Calculated" | "Judgment"> = {
  verified: "Verified",
  calculated: "Calculated",
  judgment: "Judgment",
};

const ERROR_MESSAGES: Record<AskFailure, string> = {
  "invalid-question": "The question must be between 3 and 500 characters.",
  "no-key": "Asking is unavailable — no provider key is configured.",
  "no-snapshot": "No strategic snapshot yet — the daily job promotes the first one.",
  "provider-error": "The model could not be reached. Nothing was saved.",
  "invalid-answer":
    "The answer failed deterministic validation and was discarded. Nothing was saved.",
};

function DecisionAnswer({ decision }: { decision: DecisionRow }) {
  const answer = decision.answer as AskAnswer;
  const context = decision.context as AskContext;
  const reviewPending = decision.requiresManualReview && !decision.reviewedAt;

  return (
    <section className="card mt-6 p-5 sm:p-7">
      <p className="fine-print flex flex-wrap items-center gap-2">
        {decision.createdAt.toISOString().slice(0, 10)} · {decision.model}
        <Tag kind="Judgment" />
      </p>
      <p className="font-display mt-3 text-3xl">{decision.question}</p>

      <ul className="mt-6 space-y-4 border-t border-[var(--ink)] pt-6">
        {answer.statements.map((statement, i) => (
          <li key={i} className="text-sm leading-6">
            <span
              className={
                statement.label === "judgment" ? "italic text-[var(--ink-soft)]" : "text-[var(--ink)]"
              }
            >
              {renderStatementText(statement.text, context.metrics)}
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

      {reviewPending && (
        <div className="notice notice-orange mt-6">
          <p className="font-semibold">{MANUAL_REVIEW_SENTENCE}</p>
          <form
            action={submitMarkReviewed}
            className="mt-4 flex flex-col gap-2 sm:flex-row"
          >
            <input type="hidden" name="id" value={decision.id} />
            <input
              name="chosenAction"
              placeholder="Chosen action (optional)"
              className="control flex-1"
            />
            <button type="submit" className="button-primary">
              Mark reviewed
            </button>
          </form>
        </div>
      )}
      {decision.reviewedAt && (
        <p className="mt-4 text-sm italic text-[var(--ink-soft)]">
          Reviewed {decision.reviewedAt.toISOString().slice(0, 10)}
          {decision.chosenAction && ` · chosen action: ${decision.chosenAction}`}
        </p>
      )}

      <p className="fine-print mt-4">
        Snapshot {decision.snapshotId} · figures rendered from deterministic
        metrics — the model never originates a number.
      </p>
    </section>
  );
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; err?: string; dropped?: string }>;
}) {
  const params = await searchParams;
  const asOf = new Date().toISOString().slice(0, 10);
  const [history, track] = await Promise.all([
    listDecisions(20),
    // The journal still renders if the snapshot can't be computed; outcomes
    // are an enrichment, never a precondition for showing the history.
    liveTrackRecord(asOf).catch(() => null),
  ]);
  const outcomeById = new Map(
    (track?.value.outcomes ?? []).map((o) => [o.decisionId, o]),
  );
  const hasKey = Boolean(getServerEnv().OPENAI_API_KEY);
  const selected = params.d ? await getDecision(params.d) : null;
  const error = params.err ? ERROR_MESSAGES[params.err as AskFailure] : null;

  return (
    <PageShell>
      <PageHeader title="Ask" />

      {!hasKey ? (
        <p className="notice notice-plain">
          Asking is unavailable — no provider key is configured on this host.
        </p>
      ) : (
        <Card className="p-5 sm:p-8">
        <form action={submitQuestion}>
          <label htmlFor="question" className="eyebrow">
            Ask the financial brain
          </label>
          <textarea
            id="question"
            name="question"
            rows={3}
            required
            minLength={3}
            maxLength={500}
            placeholder="e.g. How is my runway looking for FIRE?"
            className="control mt-4 text-base"
          />
          <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="max-w-2xl text-xs italic leading-5 text-[var(--ink-faint)]">
            The model sees calculator summaries only — never accounts or
            movements. Answers are labelled and saved to the decision journal.
          </p>
          <SubmitButton />
          </div>
        </form>
        </Card>
      )}

      {error && (
        <p className="notice notice-amber mt-4">
          {error}
        </p>
      )}
      {params.dropped && selected && (
        <p className="notice notice-amber mt-4">
          {params.dropped} statement{params.dropped === "1" ? "" : "s"} failed
          deterministic validation (invented figures or uncited claims) and
          {params.dropped === "1" ? " was" : " were"} discarded.
        </p>
      )}

      {selected && <DecisionAnswer decision={selected} />}

      <section className="mt-14">
        <SectionHeading>
          Decision journal &amp; track record
          <Tag kind="Calculated" />
        </SectionHeading>
        {history.length > 0 && (
          <p className="-mt-3 mb-4 text-sm italic leading-6 text-[var(--ink-soft)]">
            Every answer, with what happened since it was decided — each
            decision&apos;s pinned snapshot re-measured against today&apos;s
            computed state.
          </p>
        )}
        {history.length === 0 ? (
          <div className="empty-state">
            <p className="font-display text-xl">
              No questions asked yet.
            </p>
            <p className="mt-2 text-sm italic">
              Answers you request will be saved here with their source snapshot.
            </p>
          </div>
        ) : (
          <ul className="card divide-y divide-[var(--hairline)] overflow-hidden">
            {history.map((decision) => {
              const outcome = outcomeById.get(decision.id);
              return (
                <li key={decision.id}>
                  <Link
                    href={`/ask?d=${decision.id}`}
                    className="block px-5 py-4 text-sm transition-colors hover:bg-[#fffdf5]"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                      <span className="min-w-0 sm:truncate">
                        {decision.question}
                      </span>
                      <span className="fine-print shrink-0">
                        {decision.requiresManualReview && !decision.reviewedAt && (
                          <span className="mr-2 border border-[#8e4f1d] px-1.5 py-0.5 text-[#8e4f1d]">
                            review pending
                          </span>
                        )}
                        {decision.reviewedAt && (
                          <span className="mr-2 border border-[var(--hairline)] px-1.5 py-0.5">
                            reviewed
                          </span>
                        )}
                        {decision.createdAt.toISOString().slice(0, 10)}
                      </span>
                    </div>
                    {outcome && <OutcomeLine outcome={outcome} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
