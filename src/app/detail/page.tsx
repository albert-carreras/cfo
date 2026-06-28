import Link from "next/link";
import { createId } from "@paralleldrive/cuid2";
import { computeSnapshot } from "@/calc/snapshot";
import { formatEUR, formatEURCoarse, formatYearsCoarse } from "@/calc/money";
import { loadFacts } from "@/server/facts";
import {
  latestSnapshot,
  isReviewDue,
  latestStrategicSnapshot,
  storedSnapshotResult,
} from "@/server/snapshots";
import { Amount, AmountsProvider, AmountsToggle } from "../amounts";
import {
  BrandLogo,
  Card,
  PageHeader,
  PageShell,
  SectionHeading,
  Tag,
} from "../ui";

export const dynamic = "force-dynamic";

// Full depth, one tap from home (principle #8). Shows the last STRATEGIC
// snapshot (the calm monthly surface) like the old home did; amounts start
// hidden and reveal per visit only (hidden totals).

export default async function DetailPage() {
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
        <h1 className="font-display mt-8 text-4xl">Details</h1>
        <p className="mt-4 text-[var(--ink-soft)]">
          {loadError ? "Could not reach the database." : "No data yet."}
        </p>
        <Link href="/" className="button-secondary mt-7">
          ← Home
        </Link>
      </PageShell>
    );
  }

  const {
    facts,
    accountNameById,
    holdingNameById,
    propertyNameById,
    sourceLabelById,
  } = bundle;
  const asOf = new Date().toISOString().slice(0, 10);

  const [lastStrategic, lastInternal] = await Promise.all([
    latestStrategicSnapshot(),
    latestSnapshot("internal"),
  ]);
  const storedStrategic = lastStrategic
    ? storedSnapshotResult(lastStrategic)
    : null;
  const lastInternalDate = lastInternal
    ? storedSnapshotResult(lastInternal).asOf ?? lastInternal.asOf
    : null;
  const reviewDue = isReviewDue(lastStrategic?.computedAt ?? null, asOf);

  const currentSnapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue,
    facts,
    propertyNameById,
    holdingNameById,
  });

  const visibleSnapshot = storedStrategic ?? currentSnapshot;
  const nw = visibleSnapshot.netWorth.value;
  const fire = visibleSnapshot.fire.value;
  const dq = currentSnapshot.dataQuality.value;
  const tax = visibleSnapshot.taxES.value;

  // The deterministic tax-table currency flag surfaces here, next to
  // the number it qualifies.
  const taxTablesFlagged = dq.missing.some((label) =>
    label.startsWith("Tax tables"),
  );

  // The observed ECB-fed inflation — calibration context next to the
  // assumption-driven real view, never an input to it.
  const observedInflation =
    facts.assumptions.find((a) => a.key === "inflation")?.value ?? null;
  const pct = (value: string, dp = 1) => `${(Number(value) * 100).toFixed(dp)}%`;

  const label = (id: string) =>
    sourceLabelById[id] ??
    accountNameById[id] ??
    holdingNameById[id] ??
    id;

  const buckets: { label: string; value: string }[] = [
    { label: "Liquid", value: nw.liquidEUR },
    { label: "Investable", value: nw.investableEUR },
    { label: "Locked (pension)", value: nw.lockedEUR },
    { label: "Illiquid (property)", value: nw.illiquidEUR },
  ];

  // The decision scenarios and the concentration classification the
  // strategic snapshot carries (absent on legacy stored snapshots).
  const scenarios = visibleSnapshot.scenarios ?? [];
  const conc = visibleSnapshot.concentration?.value ?? null;
  const concentrationRows = conc
    ? [
        ...conc.positions.map((p) => ({
          key: `position-${p.holdingId}`,
          label: `${holdingNameById[p.holdingId] ?? p.isin} (of investable)`,
          ...p,
        })),
        ...conc.brokers.map((b) => ({
          key: `broker-${b.accountId}`,
          label: `${accountNameById[b.accountId] ?? b.accountId} (of investable)`,
          ...b,
        })),
        ...(conc.realEstate
          ? [{ key: "real-estate", label: "Real estate (of net worth)", ...conc.realEstate }]
          : []),
        ...(conc.spain
          ? [{ key: "spain", label: "Spain exposure (of net worth)", ...conc.spain }]
          : []),
      ]
    : [];

  return (
    <AmountsProvider>
      <PageShell>
        <PageHeader title="Details" actions={<AmountsToggle />} />

        <div className="eyebrow mb-12 flex flex-col gap-2 border-b border-t-2 border-b-[var(--hairline)] border-t-[var(--ink)] py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p>
            Strategic snapshot as of{" "}
            <span className="text-[var(--ink)]">{visibleSnapshot.asOf}</span>
          </p>
          {lastInternalDate && (
            <p>
              Latest daily compute{" "}
              <span className="text-[var(--ink)]">{lastInternalDate}</span>
            </p>
          )}
          <p>
            Data quality:{" "}
            <span className="text-[var(--ink)]">{dq.score}</span>
            {dq.missing.length > 0 && ` · Missing: ${dq.missing.join(", ")}`}
          </p>
        </div>
        {dq.flags.length > 0 && (
          <p className="notice notice-amber -mt-8 mb-10">
            {dq.flags.join(" · ")}
          </p>
        )}

        {/* Net worth */}
        <section>
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--ink)] p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <span className="eyebrow">Net worth</span>
                <Tag kind="Calculated" />
              </div>
              {/* Coarse by design; exact figures live in provenance. */}
              <div className="font-display mt-5 text-6xl sm:text-8xl">
                <Amount>{formatEURCoarse(nw.totalEUR)}</Amount>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--hairline)] sm:grid-cols-4 sm:divide-y-0">
            {buckets.map((b) => (
              <div key={b.label} className="min-w-0 p-4 sm:p-5">
                <div className="fine-print">{b.label}</div>
                <div className="mt-2 tabular-nums">
                  <Amount>{formatEURCoarse(b.value)}</Amount>
                </div>
              </div>
            ))}
            </div>
          </Card>
        </section>

        {/* Runway / FIRE */}
        <section className="mt-14">
          <SectionHeading>Plan resilience</SectionHeading>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Runway</span>
              <Tag kind="Calculated" />
            </div>
            <div className="font-display mt-5 text-5xl">
              {fire.runwayYears === null
                ? "—"
                : formatYearsCoarse(fire.runwayYears)}
            </div>
            <div className="mt-2 text-sm italic leading-6 text-[var(--ink-soft)]">
              {fire.runwayYears === null ? (
                "no spend assumption set"
              ) : (
                <>
                  at <Amount>{formatEURCoarse(fire.monthlySpendEUR)}</Amount>/mo
                  (assumption, reviewed yearly)
                </>
              )}
            </div>
            {fire.bands ? (
              fire.bands.conservative.runwayYears !== null &&
              fire.bands.optimistic.runwayYears !== null && (
                <div className="fine-print mt-2">
                  {formatYearsCoarse(fire.bands.conservative.runwayYears)}{" "}
                  conservative ·{" "}
                  {formatYearsCoarse(fire.bands.optimistic.runwayYears)}{" "}
                  optimistic ({fire.bands.version})
                </div>
              )
            ) : (
              (fire.runwayMonthsConservative ?? null) !== null &&
              (fire.runwayMonthsOptimistic ?? null) !== null && (
                <div className="fine-print mt-2">
                  {formatYearsCoarse(fire.runwayMonthsConservative! / 12)}{" "}
                  conservative ·{" "}
                  {formatYearsCoarse(fire.runwayMonthsOptimistic! / 12)}{" "}
                  optimistic
                </div>
              )
            )}
            {fire.real && (
              <div className="fine-print mt-2">
                {fire.real.sustainable
                  ? "sustainable indefinitely"
                  : `${formatYearsCoarse(fire.real.realRunwayYears!)} with growth`}{" "}
                at your assumed {pct(fire.real.expectedReturnAnnual)} return,{" "}
                {pct(fire.real.longRunInflationAnnual)} long-run inflation
                (assumptions)
              </div>
            )}
          </Card>
          <Card className="p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Safe monthly spend</span>
              <Tag kind="Calculated" />
            </div>
            <div className="font-display mt-5 text-5xl">
              {fire.safeMonthlySpendEUR === null ? (
                "—"
              ) : (
                <Amount>{formatEURCoarse(fire.safeMonthlySpendEUR)}</Amount>
              )}
            </div>
            <div className="mt-2 text-sm italic leading-6 text-[var(--ink-soft)]">
              {fire.safeWithdrawalRate === null
                ? "safe withdrawal rate missing"
                : `at ${(Number(fire.safeWithdrawalRate) * 100).toFixed(1)}% SWR`}
            </div>
            {fire.bands &&
              fire.bands.failureModes.spendRisePct !== null &&
              fire.bands.failureModes.assetDropPct !== null &&
              fire.bands.failureModes.swrFloorPct !== null && (
                <div className="fine-print mt-2">
                  {fire.bands.failureModes.spendRisePct >= 0 ? (
                    <>
                      breaks if spend rises{" "}
                      {fire.bands.failureModes.spendRisePct.toFixed(0)}%, the
                      pile drops{" "}
                      {fire.bands.failureModes.assetDropPct.toFixed(0)}%, or
                      the rate falls below{" "}
                      {fire.bands.failureModes.swrFloorPct.toFixed(1)}%
                    </>
                  ) : (
                    <>
                      spend already sits above the safe draw — holding it
                      would need a{" "}
                      {fire.bands.failureModes.swrFloorPct.toFixed(1)}% rate
                    </>
                  )}
                  {fire.bands.conservative.holds !== null && (
                    <>
                      {" "}
                      · {fire.bands.conservative.holds
                        ? "holds"
                        : "does not hold"}{" "}
                      in the conservative band
                    </>
                  )}
                </div>
              )}
            {fire.actualWithdrawalRate != null && (
              <div className="fine-print mt-2">
                you currently draw {pct(fire.actualWithdrawalRate, 2)} of the
                pile
                {observedInflation !== null && (
                  <> · observed inflation {pct(observedInflation)} (Spain HICP, feed)</>
                )}
              </div>
            )}
          </Card>
          </div>
        </section>

        {/* Tax estimate — a planning number (principle #10) */}
        <section className="mt-14">
          <SectionHeading>
            Income &amp; wealth tax · {tax.year}
            <Tag kind="Calculated" />
          </SectionHeading>
          <Card className="p-6 sm:p-8">
            <div className="eyebrow">Planning estimate</div>
            <div className="font-display mt-4 text-5xl">
              <Amount>{formatEURCoarse(tax.totalTaxEUR)}</Amount>
            </div>
          {taxTablesFlagged && (
            <p className="notice notice-amber mt-5">
              The tax tables ({visibleSnapshot.taxES.version}
              {tax.wealth ? `, ${tax.wealth.version}` : ""}) may not cover the
              current tax year — treat this estimate as out of date until they
              are reviewed.
            </p>
          )}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="border border-[var(--hairline)] p-4">
              <div className="fine-print">
                Savings base (
                <Amount>{formatEURCoarse(tax.savingsBaseEUR)}</Amount>)
              </div>
              <div className="mt-2 tabular-nums">
                <Amount>{formatEURCoarse(tax.savingsTaxEUR)}</Amount>
              </div>
            </div>
            <div className="border border-[var(--hairline)] p-4">
              <div className="fine-print">
                General base (
                <Amount>{formatEURCoarse(tax.generalBaseEUR)}</Amount>)
              </div>
              <div className="mt-2 tabular-nums">
                <Amount>{formatEURCoarse(tax.generalTaxEUR)}</Amount>
              </div>
            </div>
            {tax.wealth && (
              <div className="border border-[var(--hairline)] p-4">
                <div className="fine-print">
                  Wealth tax · taxable (
                  <Amount>{formatEURCoarse(tax.wealth.taxableEUR)}</Amount>)
                  after pension, vivienda &amp; the €500k mínimo
                </div>
                <div className="mt-2 tabular-nums">
                  <Amount>{formatEURCoarse(tax.wealth.quotaEUR)}</Amount>
                  {Number(tax.wealth.limitReductionEUR) > 0 && (
                    <span className="fine-print">
                      {" "}
                      · IRPF–IP cap saved{" "}
                      <Amount>{formatEURCoarse(tax.wealth.limitReductionEUR)}</Amount>
                    </span>
                  )}
                </div>
              </div>
            )}
            {Number(tax.lossCarryForwardRemainingEUR ?? 0) > 0 && (
              <div className="border border-[var(--hairline)] p-4">
                <div className="fine-print">Loss carry-forward still available</div>
                <div className="mt-2 tabular-nums">
                  <Amount>
                    {formatEURCoarse(tax.lossCarryForwardRemainingEUR as string)}
                  </Amount>
                </div>
              </div>
            )}
          </div>
          <p className="fine-print mt-5 border-t border-[var(--hairline)] pt-4">
            Planning estimate · {visibleSnapshot.taxES.source} ·{" "}
            {visibleSnapshot.taxES.version}
            {tax.wealth ? <> · {tax.wealth.version}</> : null}
          </p>
          {tax.exclusions && tax.exclusions.length > 0 && (
            <p className="fine-print mt-2">
              Excludes: {tax.exclusions.join("; ")}.
            </p>
          )}
          </Card>
        </section>

        {/* Decision scenarios — deterministic counterfactuals. */}
        {scenarios.length > 0 && (
          <section className="mt-14">
            <SectionHeading>
              Decisions
              <Tag kind="Calculated" />
            </SectionHeading>
            <div className="grid grid-cols-1 gap-4">
              {scenarios.map((s) => {
                const d = s.value.diff;
                const cells: { label: string; today: string; after: string }[] = [
                  {
                    label: "Runway",
                    today:
                      d.runwayYears.base === null
                        ? "—"
                        : formatYearsCoarse(d.runwayYears.base),
                    after:
                      d.runwayYears.variant === null
                        ? "—"
                        : formatYearsCoarse(d.runwayYears.variant),
                  },
                ];
                return (
                  <Card key={s.value.key} className="p-6 sm:p-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="eyebrow">{s.value.label}</span>
                      <Tag kind="Calculated" />
                      {s.value.irreversible && (
                        <span className="fine-print">
                          irreversible — manual review before acting
                        </span>
                      )}
                      {s.value.basisIncomplete && (
                        <span className="fine-print">
                          basis missing — Δ excludes the unknown sale taxes
                          (upper bound)
                        </span>
                      )}
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {cells.map((c) => (
                        <div key={c.label} className="border border-[var(--hairline)] p-4">
                          <div className="fine-print">{c.label}</div>
                          <div className="mt-2 tabular-nums">
                            {c.today} → {c.after}
                          </div>
                        </div>
                      ))}
                      <div className="border border-[var(--hairline)] p-4">
                        <div className="fine-print">Safe monthly spend</div>
                        <div className="mt-2 tabular-nums">
                          {d.safeMonthlySpend.baseEUR === null ? (
                            "—"
                          ) : (
                            <Amount>{formatEURCoarse(d.safeMonthlySpend.baseEUR)}</Amount>
                          )}{" "}
                          →{" "}
                          {d.safeMonthlySpend.variantEUR === null ? (
                            "—"
                          ) : (
                            <Amount>{formatEURCoarse(d.safeMonthlySpend.variantEUR)}</Amount>
                          )}
                        </div>
                      </div>
                      <div className="border border-[var(--hairline)] p-4">
                        <div className="fine-print">
                          {s.value.basisIncomplete
                            ? "Δ net worth (before unknown tax)"
                            : "Δ net worth (incl. tax)"}
                        </div>
                        <div className="mt-2 tabular-nums">
                          <Amount>{formatEURCoarse(d.netWorthTotal.deltaEUR)}</Amount>
                        </div>
                      </div>
                      <div className="border border-[var(--hairline)] p-4">
                        <div className="fine-print">One-off tax</div>
                        <div className="mt-2 tabular-nums">
                          {s.value.oneOffTaxEUR === null ? (
                            "unknown"
                          ) : (
                            <Amount>{formatEURCoarse(s.value.oneOffTaxEUR)}</Amount>
                          )}
                        </div>
                      </div>
                    </div>
                    {s.value.spreadTaxSavingEUR && (
                      <p className="mt-4 text-sm italic leading-6 text-[var(--ink-soft)]">
                        Selling over several years instead of at once{" "}
                        {Number(s.value.spreadTaxSavingEUR) < 0
                          ? "costs"
                          : "saves"}{" "}
                        <Amount>
                          {formatEURCoarse(
                            String(Math.abs(Number(s.value.spreadTaxSavingEUR))),
                          )}
                        </Amount>{" "}
                        {Number(s.value.spreadTaxSavingEUR) < 0 ? "more " : ""}
                        in capital-gains tax (today&apos;s price and tables)
                        {s.value.spreadTaxDeltaGrownEUR != null && (
                          <>
                            {" — "}
                            {Number(s.value.spreadTaxDeltaGrownEUR) < 0
                              ? "costs"
                              : "saves"}{" "}
                            <Amount>
                              {formatEURCoarse(
                                String(
                                  Math.abs(
                                    Number(s.value.spreadTaxDeltaGrownEUR),
                                  ),
                                ),
                              )}
                            </Amount>{" "}
                            {Number(s.value.spreadTaxDeltaGrownEUR) < 0
                              ? "more "
                              : ""}
                            if grown at your assumed{" "}
                            {pct(s.value.grownAtReturnAnnual!)} (assumption)
                          </>
                        )}
                        .
                      </p>
                    )}
                    {d.status.base.status !== d.status.variant.status && (
                      <p className="mt-3 text-sm italic leading-6 text-[var(--ink-soft)]">
                        Status would move from “{d.status.base.label}” to “
                        {d.status.variant.label}”.
                      </p>
                    )}
                    {s.value.yieldComparison?.realNetYield != null &&
                      s.value.yieldComparison.etfRealReturn != null && (
                        <p className="fine-print mt-3">
                          unlevered real net rental yield{" "}
                          {pct(s.value.yieldComparison.realNetYield)} vs{" "}
                          {pct(s.value.yieldComparison.etfRealReturn)} assumed
                          real ETF return (your assumption)
                        </p>
                      )}
                    <details className="mt-4 text-sm">
                      <summary className="fine-print cursor-pointer">
                        Breakdown &amp; what this leaves out
                      </summary>
                      <div className="mt-3 space-y-1 border-t border-[var(--hairline)] pt-3">
                        {s.value.breakdown.map((row) => (
                          <div key={row.label} className="flex justify-between gap-4">
                            <span className="text-[var(--ink-soft)]">{row.label}</span>
                            <span className="tabular-nums">
                              {row.valueEUR === null ? (
                                "unknown"
                              ) : (
                                <Amount>{formatEUR(row.valueEUR)}</Amount>
                              )}
                              {row.presentValueEUR != null && (
                                <span className="fine-print">
                                  {" "}
                                  ≈ <Amount>{formatEURCoarse(row.presentValueEUR)}</Amount>{" "}
                                  today
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                        <p className="fine-print pt-2">
                          Excludes: {s.value.exclusions.join("; ")} ·{" "}
                          {s.source} · {s.version}
                        </p>
                      </div>
                    </details>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Concentration — classified, never shamed. */}
        {concentrationRows.length > 0 && (
          <section className="mt-14">
            <SectionHeading>
              Concentration
              <Tag kind="Calculated" />
            </SectionHeading>
            <div className="table-shell">
              <table className="data-table min-w-[28rem]">
                <thead className="text-left">
                  <tr>
                    <th>Exposure</th>
                    <th className="text-right">Share</th>
                    <th className="text-right">Ceiling</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {concentrationRows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.label}
                        {row.above && (
                          <span className="fine-print"> · above ceiling</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{row.pct}%</td>
                      <td className="text-right tabular-nums">{row.ceilingPct}%</td>
                      <td className="text-right">
                        <Amount>{formatEURCoarse(row.valueEUR)}</Amount>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Holdings (provenance-rich) */}
        <section className="mt-14">
          <SectionHeading>
            Holdings
            <Tag kind="Calculated" />
          </SectionHeading>
          <div className="table-shell">
          <table className="data-table min-w-[38rem]">
            <thead className="text-left">
              <tr>
                <th>Holding</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price (EUR)</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {visibleSnapshot.valuation.value.holdings.map((h) => (
                <tr key={h.holdingId}>
                  <td>{holdingNameById[h.holdingId] ?? h.isin}</td>
                  <td className="text-right">
                    <Amount>{h.quantity}</Amount>
                  </td>
                  <td className="text-right">{formatEUR(h.priceEUR)}</td>
                  <td className="text-right">
                    <Amount>{formatEUR(h.valueEUR)}</Amount>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>

        {/* Provenance — one tap away */}
        <details className="card mt-14 p-5 text-sm sm:p-6">
          <summary className="eyebrow cursor-pointer">
            Where do these numbers come from?
          </summary>
          <div className="mt-5 space-y-4 border-t border-[var(--hairline)] pt-5 text-[var(--ink-soft)]">
            {/* The exact figures — the surface above is coarse by design. */}
            <div className="text-xs">
              Exact: net worth <Amount>{formatEUR(nw.totalEUR)}</Amount> ·
              runway{" "}
              {fire.runwayMonths === null
                ? "—"
                : `${fire.runwayMonths} months`}{" "}
              at <Amount>{formatEUR(fire.monthlySpendEUR)}</Amount>/mo · safe
              spend{" "}
              {fire.safeMonthlySpendEUR === null ? (
                "—"
              ) : (
                <Amount>{formatEUR(fire.safeMonthlySpendEUR)}</Amount>
              )}
              /mo · tax <Amount>{formatEUR(tax.totalTaxEUR)}</Amount>
            </div>
            {[
              { calc: visibleSnapshot.netWorth, asOf: visibleSnapshot.asOf },
              { calc: visibleSnapshot.valuation, asOf: visibleSnapshot.asOf },
              { calc: visibleSnapshot.fire, asOf: visibleSnapshot.asOf },
              { calc: currentSnapshot.dataQuality, asOf: currentSnapshot.asOf },
              { calc: visibleSnapshot.taxES, asOf: visibleSnapshot.asOf },
            ].map(({ calc, asOf: calcAsOf }) => (
              <div key={calc.source}>
                <div className="fine-print">
                  {calc.source} · {calc.version} · as of {calcAsOf}
                </div>
                <div className="text-xs">
                  inputs:{" "}
                  {calc.inputs.map((id) => label(id)).join(", ") || "—"}
                </div>
              </div>
            ))}
          </div>
        </details>
      </PageShell>
    </AmountsProvider>
  );
}
