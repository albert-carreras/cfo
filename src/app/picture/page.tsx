import { renderStatementParts } from "@/ai/schema";
import type {
  PictureContext,
  PictureNarrative,
  StatementLabel,
} from "@/ai/types";
import { snapshotSummary, type SnapshotSummary } from "@/calc/materialChange";
import { formatEURCoarse } from "@/calc/money";
import { picture as pictureCalc, type PictureValue } from "@/calc/picture";
import type { CalcResult } from "@/calc/types";
import type { MetricEntry } from "@/ai/types";
import { latestPicture, type PictureRow } from "@/server/pictures";
import {
  latestSnapshot,
  latestStrategicSnapshot,
  storedSnapshotResult,
} from "@/server/snapshots";
import { Amount, AmountsProvider, AmountsToggle } from "../amounts";
import { Card, PageHeader, PageShell, Tag } from "../ui";
import { refreshPicture } from "./actions";
import { RefreshButton } from "./RefreshButton";

export const dynamic = "force-dynamic";

// The picture — the standing reassurance narrative. The page renders the last
// stored row instantly: the analyst's sectioned essay when one survived
// validation (scope "full"), and always the deterministic floor (the
// picture.v1 ratios + the snapshot summary) underneath or instead. Regenerated
// when a strategic snapshot is promoted, or on the refresh button.

const TAG_BY_LABEL: Record<StatementLabel, "Verified" | "Calculated" | "Judgment"> = {
  verified: "Verified",
  calculated: "Calculated",
  judgment: "Judgment",
};

function formatGeneratedAt(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: "Europe/Madrid",
  }).format(date);
}

// A statement with every metric value (a figure about the user) behind the
// hidden-amounts toggle — the prose stays readable, the numbers stay calm.
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

function Narrative({
  narrative,
  context,
}: {
  narrative: PictureNarrative;
  context: PictureContext;
}) {
  return (
    <div className="space-y-6">
      {narrative.sections.map((section, s) => (
        <section key={s}>
          <h2 className="section-title">{section.heading}</h2>
          <ul className="mt-2 space-y-3">
            {section.statements.map((statement, i) => (
              <li key={i} className="text-sm leading-6">
                <span
                  className={
                    statement.label === "judgment"
                      ? "italic text-[var(--ink-soft)]"
                      : "text-[var(--ink)]"
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
        </section>
      ))}
    </div>
  );
}

// The deterministic floor — the calm template every scope can stand on. Pure
// presentation over the pinned Calculated values; no voice, no judgment.
function DeterministicPicture({
  derived,
  summary,
}: {
  derived: CalcResult<PictureValue>;
  summary: SnapshotSummary;
}) {
  const d = derived.value;
  const pct = (v: number | null) => (v === null ? null : `${v}%`);
  const lines: { label: string; value: string | null }[] = [
    { label: "Net worth", value: formatEURCoarse(summary.totalNetWorthEUR) },
    {
      label: "Runway — cash and investments only, at the current spend",
      value:
        d.runwayYearsCoarse === null ? null : `${d.runwayYearsCoarse} years`,
    },
    {
      label: "Spend vs the safe monthly draw",
      value:
        d.spendVsSafeSpendPct === null
          ? null
          : `${d.spendVsSafeSpendPct}% used · ${d.spendHeadroomPct}% headroom`,
    },
    {
      label: "The shape of it — liquid / investable / pension / property",
      value:
        d.liquidSharePct === null
          ? null
          : [d.liquidSharePct, d.investableSharePct, d.lockedSharePct, d.illiquidSharePct]
              .map((v) => pct(v) ?? "—")
              .join(" / "),
    },
    { label: "Status", value: summary.status },
  ];

  return (
    <div>
      <ul className="space-y-2">
        {lines
          .filter((l) => l.value !== null)
          .map((l) => (
            <li key={l.label} className="text-sm leading-6">
              <span className="fine-print">{l.label}</span>{" "}
              <span className="block text-[var(--ink)]">
                <Amount>{l.value}</Amount>
                <span className="ml-2 inline-flex align-middle">
                  <Tag kind="Calculated" />
                </span>
              </span>
            </li>
          ))}
      </ul>
      <p className="fine-print mt-3">
        {derived.source} · {derived.version}
      </p>
    </div>
  );
}

export default async function PicturePage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; refreshed?: string }>;
}) {
  const { err, refreshed } = await searchParams;
  const row: PictureRow | null = await latestPicture();
  const latestInternal = await latestSnapshot("internal");
  const latestInternalDate = latestInternal
    ? storedSnapshotResult(latestInternal).asOf ?? latestInternal.asOf
    : null;

  // No row yet (nothing promoted since the feature shipped, or a fresh
  // install): compute the floor live from the latest strategic snapshot so the
  // page is never empty when the numbers exist.
  let live: { derived: CalcResult<PictureValue>; summary: SnapshotSummary } | null =
    null;
  if (!row) {
    const snapRow = await latestStrategicSnapshot();
    if (snapRow) {
      const snapshot = storedSnapshotResult(snapRow);
      live = {
        derived: pictureCalc({
          snapshotId: snapshot.snapshotId,
          netWorth: snapshot.netWorth.value,
          fire: snapshot.fire.value,
          inputs: [snapshot.netWorth.source, snapshot.fire.source],
        }),
        summary: snapshotSummary(snapshot),
      };
    }
  }

  const summary = (row?.summary ?? live?.summary) as SnapshotSummary | undefined;
  const derived = (row?.derived ?? live?.derived) as
    | CalcResult<PictureValue>
    | undefined;
  const narrative = row?.narrative as PictureNarrative | null | undefined;
  const context = row?.context as PictureContext | null | undefined;

  return (
    <AmountsProvider>
      <PageShell narrow>
        <PageHeader
          title="The picture"
          actions={
            <>
              <AmountsToggle />
              <form action={refreshPicture}>
                <RefreshButton />
              </form>
            </>
          }
        />

        {err && (
          <p className="notice notice-orange mt-4">
            The picture could not be refreshed ({err}) — is there a strategic
            snapshot yet?
          </p>
        )}
        {!err && refreshed && row && (
          <p className="notice notice-sky mt-4">
            Picture refreshed · generated {formatGeneratedAt(row.createdAt)}
          </p>
        )}

        {!summary || !derived ? (
          <Card className="mt-6 p-5 sm:p-6">
            <p className="text-sm text-[var(--ink-soft)]">
              No snapshot yet — the picture appears once the first strategic
              snapshot exists.
            </p>
          </Card>
        ) : (
          <Card className="mt-6 p-5 sm:p-6">
            <p className="fine-print flex flex-wrap items-center gap-2">
              <span>Computed from the strategic snapshot of {summary.asOf}</span>
              {latestInternalDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>latest daily compute {latestInternalDate}</span>
                </>
              )}
              {row && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>generated {formatGeneratedAt(row.createdAt)}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              {row ? (
                row.scope === "full" ? (
                  <span>analyst narrative · {row.model}</span>
                ) : (
                  <span>deterministic only</span>
                )
              ) : (
                <span>deterministic only · not yet generated</span>
              )}
            </p>
            {row?.scope === "deterministic" && row.llmError && (
              <p className="fine-print mt-1">
                The voice did not run ({row.llmError}) — the deterministic
                floor below is complete and current.
              </p>
            )}

            {narrative && context ? (
              <>
                <div className="mt-5 border-t border-[var(--hairline)] pt-5">
                  <Narrative narrative={narrative} context={context} />
                </div>
                <div className="mt-6 border-t border-[var(--hairline)] pt-4">
                  <p className="eyebrow">The numbers underneath</p>
                  <div className="mt-2">
                    <DeterministicPicture derived={derived} summary={summary} />
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-5 border-t border-[var(--hairline)] pt-5">
                <DeterministicPicture derived={derived} summary={summary} />
              </div>
            )}
          </Card>
        )}

        <p className="fine-print mt-4">
          Regenerated when a strategic snapshot is promoted, or on refresh. The
          voice only narrates deterministic calculator output — every figure is
          a rendered metric, never a number the model produced.
        </p>
      </PageShell>
    </AmountsProvider>
  );
}
