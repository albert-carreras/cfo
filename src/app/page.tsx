import { createId } from "@paralleldrive/cuid2";
import Link from "next/link";
import { fireHeadroom } from "@/calc/fire";
import {
  FIRE_BANDS_2026,
  type FireBandParams,
} from "@/calc/config/fireBands";
import { computeSnapshot } from "@/calc/snapshot";
import { db } from "@/server/db";
import { plannedEvents } from "@/server/db/schema";
import { loadFacts } from "@/server/facts";
import { latestHealthCheck } from "@/server/healthCheck";
import {
  latestSnapshot,
  latestStrategicSnapshot,
  listSnapshots,
  storedSnapshotResult,
} from "@/server/snapshots";
import { isAmountTBD, isTimingUnknown } from "@/shared/plans";
import { checkNow } from "./actions";
import { CopyExportButton } from "./CopyExportButton";
import { SubmitButton } from "./SubmitButton";
import {
  MetricReadout,
  PageShell,
  SectionHeading,
  Sparkline,
  SystemHeader,
  Tag,
} from "./ui";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  house_purchase: "House purchase",
  property_sale: "Property sale",
  job_exit: "Work change",
  pension_withdrawal: "Pension withdrawal",
  rental_start: "Rental start",
  inheritance: "Inheritance",
};

function eur(value: string | null | undefined, digits = 0) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
  }).format(Number(value));
}

// A short, human reading of a band's stress parameters, derived from config so
// the copy can never drift from the numbers the calculator actually applies.
function describeStress(params: FireBandParams): string {
  const spendPct = Math.round((Number(params.spendMultiplier) - 1) * 100);
  const haircutPct = Math.round(Number(params.assetHaircut) * 100);
  const swrPts = Number(params.swrDelta) * 100;
  const parts = [`spend ${spendPct >= 0 ? "+" : "−"}${Math.abs(spendPct)}%`];
  if (haircutPct > 0) parts.push(`pile −${haircutPct}%`);
  parts.push(`rate ${swrPts >= 0 ? "+" : "−"}${Math.abs(swrPts)}pt`);
  return parts.join(", ");
}

function statusClass(value: "ok" | "watch" | "update") {
  return value === "ok" ? "ok" : value === "watch" ? "warn" : "bad";
}

function currentLabel(status: string) {
  if (status === "stable") return "Okay";
  if (status === "data_stale") return "Needs data";
  if (status === "review_soon") return "Review due";
  return "Worth a look";
}

export default async function PicturePage() {
  let bundle: Awaited<ReturnType<typeof loadFacts>> | null = null;
  let loadError: string | null = null;
  try {
    bundle = await loadFacts();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  if (!bundle || loadError || bundle.facts.accounts.length === 0) {
    return (
      <PageShell narrow>
        <SystemHeader
          active="picture"
          title="Personal CFO"
          kicker="CFO / CURRENT POSITION / 00"
        />
        <div className="notice notice-amber mt-8">
          <strong>{loadError ? "The financial record is unavailable." : "No financial baseline yet."}</strong>
          <p className="mt-2 text-[var(--ink-soft)]">
            {loadError
              ? "Check the database connection and migrations."
              : "Enter the starting accounts and assets once; after that, update only when something meaningful changes."}
          </p>
          {!loadError && (
            <Link href="/setup" className="button-primary mt-3">
              Start setup
            </Link>
          )}
          {loadError && <p className="fine-print mt-3">{loadError}</p>}
        </div>
      </PageShell>
    );
  }

  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const [lastCheck, openPlans, latestInternal, latestStrategic, strategicHistory] =
    await Promise.all([
      latestHealthCheck(),
      db.select().from(plannedEvents),
      latestSnapshot("internal"),
      latestStrategicSnapshot(),
      listSnapshots("strategic", 24),
    ]);
  const snapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: false,
    facts: bundle.facts,
  });
  const plans = openPlans.filter((plan) => !plan.realisedAt);
  const stalePlan = plans.some((plan) => plan.date < asOf);
  const nwSeries = strategicHistory
    .map((row) => Number(storedSnapshotResult(row).netWorth.value.totalEUR))
    .reverse();
  const nw = snapshot.netWorth.value;
  const fire = snapshot.fire.value;
  const baseHeadroom = fire.bands ? fireHeadroom(fire.bands.base) : null;
  const conservative = fire.bands?.conservative ?? null;
  const conservativeHeadroom = conservative ? fireHeadroom(conservative) : null;
  const data = snapshot.dataQuality.value;
  const currentStatus = snapshot.status.value.status;
  const checkReport = lastCheck?.report as {
    headline?: string;
    observations?: string[];
  } | null;
  const checkVerdict = (lastCheck?.verdict ?? null) as
    | "ok"
    | "watch"
    | "update"
    | null;
  const checkHeadline = checkReport?.headline ??
    (lastCheck
      ? lastCheck.llmError
        ? "The deterministic check completed; the AI note was unavailable."
        : "The latest check completed."
      : "No monthly check has run yet.");
  const pricesAsOf = bundle.facts.prices.map((row) => row.asOf).sort().at(-1) ?? "—";

  return (
    <PageShell>
      <SystemHeader
        active="picture"
        title="Picture"
        kicker={`CFO / CURRENT POSITION / ${asOf}`}
        actions={<CopyExportButton />}
      />

      <div className="status-strip">
        <div className="status-cell">
          <div className="microlabel">Current</div>
          <div className={`status-value ${currentStatus === "stable" ? "ok" : currentStatus === "data_stale" ? "bad" : "warn"}`}>
            {currentLabel(currentStatus)}
          </div>
        </div>
        <div className="status-cell">
          <div className="microlabel">Monthly check</div>
          <div className={`status-value ${checkVerdict ? statusClass(checkVerdict) : ""}`}>
            {checkVerdict ?? "Not run yet"}
          </div>
        </div>
        <div className="status-cell">
          <div className="microlabel">Data</div>
          <div className={`status-value ${data.missingRequired.length ? "bad" : data.score === "Good" ? "ok" : "warn"}`}>
            {data.score}
          </div>
        </div>
        <div className="status-cell">
          <div className="microlabel">Future plans</div>
          <div className={`status-value ${stalePlan ? "warn" : ""}`}>
            {plans.length ? `${plans.length} open` : "None"}
          </div>
        </div>
      </div>

      <SectionHeading action={<Tag kind="Calculated" />}>Position</SectionHeading>
      <div className="metrics-grid">
        <MetricReadout
          label="Net worth"
          value={eur(nw.totalEUR)}
          accent
          note={
            <>
              Assets less recorded debt
              <Sparkline values={nwSeries} />
            </>
          }
        />
        <MetricReadout label="Liquid cash" value={eur(nw.liquidEUR)} note="Bank + manual cash" />
        <MetricReadout label="Investable" value={eur(nw.investableEUR)} note="Broker cash + securities" />
        <MetricReadout label="Property equity" value={eur(nw.illiquidEUR)} note="After recorded mortgages" />
        <MetricReadout label="Pension / locked" value={eur(nw.lockedEUR)} />
        <MetricReadout label="Other assets" value={eur(nw.otherAssetsEUR)} note="Only those marked included" muted={Number(nw.otherAssetsEUR) === 0} />
        <MetricReadout label="Recorded debt" value={eur(nw.debtEUR)} muted={Number(nw.debtEUR) === 0} />
        <MetricReadout label="Available to plan" value={eur(nw.fireCountedEUR)} note="Liquid + investable" />
      </div>

      <SectionHeading action={<Tag kind="Calculated" />}>Independence plan</SectionHeading>
      <div className="metrics-grid">
        <MetricReadout label="Monthly spending" value={eur(fire.monthlySpendEUR)} note="Planning input" />
        <MetricReadout
          label="Safe monthly spending"
          value={eur(fire.safeMonthlySpendEUR)}
          note={
            baseHeadroom === null ? (
              "At the recorded withdrawal rate"
            ) : Number(baseHeadroom) >= 0 ? (
              `${eur(baseHeadroom)}/mo inside the safe level`
            ) : (
              <span style={{ color: "var(--warn)" }}>
                {eur(String(Math.abs(Number(baseHeadroom))))}/mo over it
              </span>
            )
          }
        />
        <MetricReadout label="Zero-growth runway" value={fire.runwayYears == null ? "—" : `${fire.runwayYears.toFixed(1)}y`} />
        <MetricReadout
          label="Conservative band"
          textValue
          value={conservative?.holds == null ? "—" : conservative.holds ? "Holds" : "Does not hold"}
          note={
            <>
              Joint stress test: {describeStress(FIRE_BANDS_2026.conservative)}.{" "}
              {conservative?.holds === false &&
              conservativeHeadroom !== null &&
              conservative.monthlySpendEUR ? (
                <span style={{ color: "var(--warn)" }}>
                  Misses by {eur(String(Math.abs(Number(conservativeHeadroom))))}/mo at{" "}
                  {eur(conservative.monthlySpendEUR)}/mo spend.
                </span>
              ) : conservative?.holds ? (
                "Spend fits even under all three at once."
              ) : (
                "Open plans are not modeled."
              )}
            </>
          }
        />
      </div>

      <section id="check">
        <SectionHeading action={<Tag kind="Judgment" />}>Monthly check</SectionHeading>
        <div className={`check-panel mt-2 ${checkVerdict ? `check-${checkVerdict}` : "check-none"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="microlabel">
                {lastCheck
                  ? `${lastCheck.trigger} / ${lastCheck.model ?? "deterministic"} / ${lastCheck.createdAt.toISOString().slice(0, 10)}`
                  : "Waiting for first run"}
              </div>
              <p className="check-headline">{checkHeadline}</p>
            </div>
            <form action={checkNow} className="text-right">
              <SubmitButton className="button-primary" pendingLabel="Checking… takes ~30 s">
                Check now
              </SubmitButton>
              <p className="fine-print mt-1">Re-run on demand · ~30 s</p>
            </form>
          </div>
          {(checkReport?.observations?.length ?? 0) > 0 && (
            <ul className="check-list">
              {checkReport?.observations?.map((observation) => <li key={observation}>{observation}</li>)}
            </ul>
          )}
          <p className="fine-print mt-3">
            A dated record kept in History, distinct from “Current” above (which is live and recomputed each visit).
            It pairs the deterministic verdict with a short AI note — the trust core computes every figure; the AI only
            reads the result and adds a qualitative read, never a number. It runs automatically each month; “Check now”
            re-runs it on demand, e.g. right after a data update.
          </p>
        </div>
      </section>

      <SectionHeading>Open plans</SectionHeading>
      {plans.length === 0 ? (
        <div className="notice notice-green mt-2">No major future changes are currently recorded.</div>
      ) : (
        <div className="mt-1">
          {plans.map((plan) => (
            <div className="event-row" key={plan.id}>
              <time>{isTimingUnknown(plan.date) ? "timing unknown" : plan.date}</time>
              <div>
                <strong>{EVENT_LABEL[plan.type] ?? plan.type}</strong> · {isAmountTBD(plan.amount) ? "value TBD" : eur(plan.amount)}
                {plan.note && <span className="text-[var(--ink-soft)]"> · {plan.note}</span>}
              </div>
              <Link href="/data#plans" className="button-quiet">Edit</Link>
            </div>
          ))}
          <p className="fine-print mt-2">Plans are context, not present-day assets. Use the exported brief for decision analysis.</p>
        </div>
      )}

      <SectionHeading>System provenance</SectionHeading>
      <div className="table-shell mt-2">
        <table className="data-table">
          <thead><tr><th>Layer</th><th>Latest date</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>Market prices</td><td className="mono">{pricesAsOf}</td><td>Automatic feed</td></tr>
            <tr><td>Internal compute</td><td className="mono">{latestInternal?.asOf ?? "—"}</td><td>Daily calculated record</td></tr>
            <tr><td>Strategic snapshot</td><td className="mono">{latestStrategic?.asOf ?? "—"}</td><td>Durable comparison point</td></tr>
            <tr><td>Known data issues</td><td className="mono">{data.missing.length + data.flags.length}</td><td>{[...data.missing, ...data.flags].join(" · ") || "None"}</td></tr>
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
