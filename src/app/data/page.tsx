import { desc } from "drizzle-orm";
import type { ReactNode } from "react";
import { deriveState } from "@/calc/derive";
import { db } from "@/server/db";
import {
  accounts,
  assumptions,
  dataUpdates,
  holdings,
  liabilities,
  otherAssets,
  plannedEvents,
  properties,
  revaluations,
} from "@/server/db/schema";
import { loadFacts } from "@/server/facts";
import {
  ASSUMPTION_DESCRIPTIONS,
  ASSUMPTION_LABELS,
  EDITABLE_ASSUMPTION_KEYS,
  FEED_ASSUMPTION_KEYS,
  orderAssumptionRows,
} from "@/shared/assumptionKeys";
import { isAmountTBD, isTimingUnknown } from "@/shared/plans";
import { ACCOUNT_TYPES, PLANNED_EVENT_TYPES } from "@/shared/setup";
import { CopyExportButton } from "../CopyExportButton";
import { SubmitButton } from "../SubmitButton";
import { PageShell, SectionHeading, SystemHeader, Tag } from "../ui";
import {
  completePlan,
  createAccount,
  createHolding,
  createLoan,
  createOtherAsset,
  createPlan,
  createProperty,
  saveCurrentSnapshot,
  savePlanningInputs,
} from "./actions";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  house_purchase: "House purchase",
  property_sale: "Property sale",
  job_exit: "Work change",
  pension_withdrawal: "Pension withdrawal",
  rental_start: "Rental start",
  inheritance: "Inheritance",
};

function Field({
  label,
  name,
  children,
  help,
}: {
  label: string;
  name?: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {name && <span className="sr-only">{name}</span>}
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

function money(value: string) {
  return `€${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export default async function DataPage() {
  const [
    bundle,
    accountRows,
    holdingRows,
    propertyRows,
    liabilityRows,
    otherRows,
    eventRows,
    assumptionRows,
    revaluationRows,
    lastUpdateRows,
  ] = await Promise.all([
    loadFacts(),
    db.select().from(accounts),
    db.select().from(holdings),
    db.select().from(properties),
    db.select().from(liabilities),
    db.select().from(otherAssets),
    db.select().from(plannedEvents),
    db.select().from(assumptions),
    db.select().from(revaluations).orderBy(desc(revaluations.createdAt)),
    db.select().from(dataUpdates).orderBy(desc(dataUpdates.createdAt)).limit(1),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const lastUpdate =
    lastUpdateRows[0]?.createdAt.toISOString().slice(0, 10) ?? null;
  // Latest confirmed date per asset, from the append-only revaluations.
  const confirmedByAsset = new Map<string, string>();
  for (const rev of revaluationRows) {
    if (rev.valuedAt > today) continue;
    const key = `${rev.assetType}:${rev.assetId}`;
    const prev = confirmedByAsset.get(key);
    if (!prev || rev.valuedAt > prev) confirmedByAsset.set(key, rev.valuedAt);
  }
  // Values not confirmed in the last six months get an amber date.
  const staleThreshold = (() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const liveAccounts = accountRows.filter((row) => !row.disposedAt);
  const liveHoldings = holdingRows.filter((row) => !row.disposedAt);
  const liveProperties = propertyRows.filter((row) => !row.disposedAt);
  const liveLiabilities = liabilityRows.filter((row) => !row.disposedAt);
  const liveOtherAssets = otherRows.filter((row) => !row.disposedAt);
  const openEvents = eventRows.filter((row) => !row.realisedAt);
  const state = deriveState({
    accounts: bundle.facts.accounts,
    holdings: bundle.facts.holdings,
    movements: bundle.facts.movements,
    revaluations: bundle.facts.revaluations,
    asOf: today,
  });
  const propertyFacts = new Map(bundle.facts.properties.map((row) => [row.id, row]));
  const liabilityFacts = new Map(bundle.facts.liabilities.map((row) => [row.id, row]));
  const otherFacts = new Map((bundle.facts.otherAssets ?? []).map((row) => [row.id, row]));
  const observations = [
    ...liveAccounts.map((row) => ({
      type: "account",
      id: row.id,
      group: "Cash / account",
      label: row.name,
      value: state.cashByAccount[row.id] ?? row.openingCash,
      since: row.openingAsOf,
    })),
    ...liveHoldings.map((row) => ({
      type: "holding",
      id: row.id,
      group: "Investment quantity",
      label: row.ticker ?? row.name,
      value: state.quantityByHolding[row.id] ?? row.openingQuantity,
      since: row.openingAsOf,
    })),
    ...liveProperties.map((row) => ({
      type: "property",
      id: row.id,
      group: "Property value",
      label: row.name,
      value: propertyFacts.get(row.id)?.value ?? row.value,
      since: row.valuedAt,
    })),
    ...liveLiabilities.map((row) => ({
      type: "liability",
      id: row.id,
      group: "Debt balance",
      label: row.name ?? row.type,
      value: liabilityFacts.get(row.id)?.balance ?? row.balance,
      since: row.updatedAt.toISOString().slice(0, 10),
    })),
    ...liveOtherAssets.map((row) => ({
      type: "other_asset",
      id: row.id,
      group: "Other asset value",
      label: row.name,
      value: otherFacts.get(row.id)?.value ?? row.value,
      since: row.valuedAt,
    })),
  ];

  return (
    <PageShell>
      <SystemHeader
        active="data"
        title="Data"
        kicker="CFO / VERIFIED RECORD / UPDATE MODE"
        actions={
          <>
            <a href="/api/export" className="button-secondary">
              Export .md
            </a>
            <CopyExportButton />
          </>
        }
      />

      <div className="status-strip">
        <div className="status-cell"><div className="microlabel">Last update</div><div className="status-value">{lastUpdate ?? "—"}</div></div>
        <div className="status-cell"><div className="microlabel">Accounts</div><div className="status-value ok">{liveAccounts.length} live</div></div>
        <div className="status-cell"><div className="microlabel">Assets</div><div className="status-value ok">{liveHoldings.length + liveProperties.length + liveOtherAssets.length} tracked</div></div>
        <div className="status-cell"><div className="microlabel">Plans</div><div className="status-value">{openEvents.length} open</div></div>
      </div>

      <section id="current">
        <SectionHeading action={<Tag kind="Verified" />}>Confirm the current snapshot</SectionHeading>
        <p className="mt-2 max-w-3xl text-[0.75rem] text-[var(--ink-soft)]">
          These are dated observations, not a transaction ledger. Change what moved—or simply save the current values to confirm that the picture is still accurate. Property values are the full value; your ownership % computes your share.
        </p>
        <form action={saveCurrentSnapshot} className="mt-3">
          <input type="hidden" name="observationCount" value={observations.length} />
          <div className="table-shell">
            <table className="data-table">
              <thead><tr><th>Class</th><th>Item</th><th>Current / confirmed value</th><th>Confirmed</th></tr></thead>
              <tbody>
                {observations.map((row, index) => {
                  const confirmed = confirmedByAsset.get(`${row.type}:${row.id}`) ?? row.since;
                  const stale = confirmed < staleThreshold;
                  return (
                    <tr key={`${row.type}:${row.id}`}>
                      <td className="microlabel">{row.group}</td>
                      <td>{row.label}</td>
                      <td className="w-56">
                        <input type="hidden" name={`observation-${index}-type`} value={row.type} />
                        <input type="hidden" name={`observation-${index}-id`} value={row.id} />
                        <input className="control" name={`observation-${index}-value`} defaultValue={row.value} inputMode="decimal" required />
                      </td>
                      <td className="fine-print" style={stale ? { color: "var(--warn)" } : undefined}>{confirmed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <Field label="As of"><input className="control" name="asOf" type="date" max={today} defaultValue={today} required /></Field>
            <Field label="What changed?" help="Optional. Appears in History."><input className="control" name="note" placeholder="Quarterly confirmation / bought a car / closing statement" /></Field>
            <div className="flex items-end"><SubmitButton className="button-primary w-full" pendingLabel="Saving…">Save snapshot</SubmitButton></div>
          </div>
        </form>
      </section>

      <section id="structure">
        <SectionHeading>Add assets or debt</SectionHeading>
        <div className="notice mt-2 text-[0.72rem] leading-5 text-[var(--ink-soft)]">
          <strong className="text-[var(--ink)]">Major-event pattern:</strong> house → add property and mortgage, then confirm cash/investments above. Inheritance → add the asset received or confirm the destination balance. Car → add it only if useful context; ordinary cars stay excluded from planning net worth by default.
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <details className="form-block">
            <summary>Add account</summary>
            <form action={createAccount} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="control" name="name" required /></Field>
              <Field label="Type"><select className="control" name="type">{ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
              <Field label="Opening balance"><input className="control" name="openingCash" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="As of"><input className="control" name="openingAsOf" type="date" max={today} defaultValue={today} required /></Field>
              <SubmitButton className="button-primary sm:col-span-2" pendingLabel="Saving…">Add account</SubmitButton>
            </form>
          </details>

          <details className="form-block">
            <summary>Add investment</summary>
            <form action={createHolding} className="grid gap-3 sm:grid-cols-2">
              <Field label="Account"><select className="control" name="accountId">{liveAccounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
              <Field label="Name"><input className="control" name="name" required /></Field>
              <Field label="ISIN"><input className="control" name="isin" required /></Field>
              <Field label="Feed ticker"><input className="control" name="ticker" placeholder="VWCE.DE" /></Field>
              <Field label="Currency"><input className="control" name="currency" defaultValue="EUR" required /></Field>
              <Field label="Quantity"><input className="control" name="openingQuantity" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="As of"><input className="control" name="openingAsOf" type="date" max={today} defaultValue={today} required /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="acknowledgeUnpriced" /> Allow without feed ticker</label>
              <SubmitButton className="button-primary sm:col-span-2" pendingLabel="Saving…">Add investment</SubmitButton>
            </form>
          </details>

          <details className="form-block md:col-span-2">
            <summary>Add property + optional mortgage</summary>
            <form action={createProperty} className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><input className="control" name="name" required /></Field>
              <Field label="Current value" help="Full property value — ownership % computes your share."><input className="control" name="value" inputMode="decimal" required /></Field>
              <Field label="Purchase price"><input className="control" name="purchasePrice" inputMode="decimal" /></Field>
              <Field label="Ownership %"><input className="control" name="ownershipPct" inputMode="decimal" defaultValue="100" required /></Field>
              <Field label="Rent / month"><input className="control" name="rentMonthly" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="Costs / month"><input className="control" name="costsMonthly" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="Valued at"><input className="control" name="valuedAt" type="date" max={today} defaultValue={today} required /></Field>
              <Field label="Mortgage balance"><input className="control" name="mortgageBalance" inputMode="decimal" /></Field>
              <Field label="Mortgage rate"><input className="control" name="mortgageRate" inputMode="decimal" placeholder="0.03" /></Field>
              <Field label="Mortgage payment"><input className="control" name="mortgagePayment" inputMode="decimal" /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isPrimaryResidence" /> Primary residence</label>
              <SubmitButton className="button-primary sm:col-span-3" pendingLabel="Saving…">Add property</SubmitButton>
            </form>
          </details>

          <details className="form-block">
            <summary>Add car / other asset</summary>
            <form action={createOtherAsset} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="control" name="name" required /></Field>
              <Field label="Category"><select className="control" name="category"><option value="vehicle">Vehicle</option><option value="business">Business</option><option value="collectible">Collectible</option><option value="other">Other</option></select></Field>
              <Field label="Current value"><input className="control" name="value" inputMode="decimal" required /></Field>
              <Field label="Valued at"><input className="control" name="valuedAt" type="date" max={today} defaultValue={today} required /></Field>
              <Field label="Note"><input className="control" name="note" /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="includeInNetWorth" /> Include in planning net worth</label>
              <SubmitButton className="button-primary sm:col-span-2" pendingLabel="Saving…">Add other asset</SubmitButton>
            </form>
          </details>

          <details className="form-block">
            <summary>Add non-mortgage loan</summary>
            <form action={createLoan} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="control" name="name" placeholder="Car loan" required /></Field>
              <Field label="Balance"><input className="control" name="balance" inputMode="decimal" required /></Field>
              <Field label="Rate"><input className="control" name="rate" inputMode="decimal" placeholder="0.05" /></Field>
              <Field label="Payment / month"><input className="control" name="payment" inputMode="decimal" /></Field>
              <SubmitButton className="button-primary sm:col-span-2" pendingLabel="Saving…">Add loan</SubmitButton>
            </form>
          </details>
        </div>
      </section>

      <section id="inputs">
        <SectionHeading action={<Tag kind="Verified" />}>Planning inputs</SectionHeading>
        <form action={savePlanningInputs}>
          <div className="table-shell mt-2">
            <table className="data-table">
              <thead><tr><th>Input</th><th>Value</th><th>Last set</th></tr></thead>
              <tbody>
                {orderAssumptionRows(assumptionRows)
                  .filter((row) => (EDITABLE_ASSUMPTION_KEYS as readonly string[]).includes(row.key))
                  .map((row) => {
                    const key = row.key as keyof typeof ASSUMPTION_DESCRIPTIONS;
                    const isDate = key === "birthDate";
                    const isFeed = (FEED_ASSUMPTION_KEYS as readonly string[]).includes(key);
                    const current = row.dateValue ?? row.value ?? "";
                    return (
                      <tr key={key}>
                        <td>
                          <div className="input-label">{ASSUMPTION_LABELS[key]}</div>
                          <div className="input-desc">{ASSUMPTION_DESCRIPTIONS[key]}</div>
                          <div className="fine-print input-key">{key}{isFeed ? " · auto-updated monthly" : ""}</div>
                        </td>
                        <td className="w-56">
                          {isFeed ? (
                            <span className="mono">{current || "—"}</span>
                          ) : (
                            <>
                              <input type="hidden" name={`current-${key}`} value={current} />
                              <input className="control" name={`value-${key}`} type={isDate ? "date" : "text"} defaultValue={current} />
                            </>
                          )}
                        </td>
                        <td className="fine-print">{row.lastReviewedAt ?? "unset"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <SubmitButton className="button-primary" pendingLabel="Saving…">Save inputs</SubmitButton>
          </div>
        </form>
      </section>

      <section id="plans">
        <SectionHeading>Planned major changes</SectionHeading>
        <div className="mt-2">
          {openEvents.length === 0 ? <p className="text-[var(--ink-soft)]">No open plans.</p> : openEvents.map((event) => (
            <div className="event-row" key={event.id}>
              <time>{isTimingUnknown(event.date) ? "timing unknown" : event.date}</time>
              <div><strong>{EVENT_LABEL[event.type] ?? event.type}</strong> · {isAmountTBD(event.amount) ? "value TBD" : money(event.amount)}{event.note ? <span className="text-[var(--ink-soft)]"> · {event.note}</span> : null}</div>
              <form action={completePlan}><input type="hidden" name="id" value={event.id} /><button className="button-quiet" type="submit">Mark as done</button></form>
            </div>
          ))}
          {openEvents.length > 0 && <p className="fine-print mt-2">Mark as done once the change is reflected in the record above.</p>}
        </div>
        <details className="form-block">
          <summary>Add future plan</summary>
          <form action={createPlan} className="grid gap-3 sm:grid-cols-3">
            <Field label="Type"><select className="control" name="type">{PLANNED_EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_LABEL[type] ?? type}</option>)}</select></Field>
            <Field label="Expected date" help="Use 2050-01-01 if the timing is unknown."><input className="control" name="date" type="date" required /></Field>
            <Field label="Rough amount" help="Leave 0 if the value is not yet decided."><input className="control" name="amount" inputMode="decimal" required /></Field>
            <Field label="Context"><input className="control" name="note" placeholder="Financing not chosen yet" /></Field>
            <SubmitButton className="button-primary sm:col-span-3" pendingLabel="Saving…">Add plan</SubmitButton>
          </form>
          <p className="fine-print mt-2">Plans are context for decisions, not modeled figures. They never move a calculated number.</p>
        </details>
      </section>
    </PageShell>
  );
}
