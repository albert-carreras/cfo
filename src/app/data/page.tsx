import type { ReactNode } from "react";
import { deriveState } from "@/calc/derive";
import { db } from "@/server/db";
import {
  accounts,
  assumptions,
  holdings,
  liabilities,
  otherAssets,
  plannedEvents,
  properties,
} from "@/server/db/schema";
import { loadFacts } from "@/server/facts";
import {
  ASSUMPTION_DESCRIPTIONS,
  EDITABLE_ASSUMPTION_KEYS,
  orderAssumptionRows,
} from "@/shared/assumptionKeys";
import { ACCOUNT_TYPES, PLANNED_EVENT_TYPES } from "@/shared/setup";
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
  savePlanningInput,
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
  const [bundle, accountRows, holdingRows, propertyRows, liabilityRows, otherRows, eventRows, assumptionRows] =
    await Promise.all([
      loadFacts(),
      db.select().from(accounts),
      db.select().from(holdings),
      db.select().from(properties),
      db.select().from(liabilities),
      db.select().from(otherAssets),
      db.select().from(plannedEvents),
      db.select().from(assumptions),
    ]);
  const today = new Date().toISOString().slice(0, 10);
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
    })),
    ...liveHoldings.map((row) => ({
      type: "holding",
      id: row.id,
      group: "Investment quantity",
      label: row.ticker ?? row.name,
      value: state.quantityByHolding[row.id] ?? row.openingQuantity,
    })),
    ...liveProperties.map((row) => ({
      type: "property",
      id: row.id,
      group: "Property value",
      label: row.name,
      value: propertyFacts.get(row.id)?.value ?? row.value,
    })),
    ...liveLiabilities.map((row) => ({
      type: "liability",
      id: row.id,
      group: "Debt balance",
      label: row.name ?? row.type,
      value: liabilityFacts.get(row.id)?.balance ?? row.balance,
    })),
    ...liveOtherAssets.map((row) => ({
      type: "other_asset",
      id: row.id,
      group: "Other asset value",
      label: row.name,
      value: otherFacts.get(row.id)?.value ?? row.value,
    })),
  ];

  return (
    <PageShell>
      <SystemHeader
        active="data"
        title="Financial data"
        kicker="CFO / VERIFIED RECORD / UPDATE MODE"
        actions={
          <a href="/api/export" className="button-secondary">
            Export .md
          </a>
        }
      />

      <div className="status-strip">
        <div className="status-cell"><div className="microlabel">Mode</div><div className="status-value warn">Changes enabled</div></div>
        <div className="status-cell"><div className="microlabel">Accounts</div><div className="status-value ok">{liveAccounts.length} live</div></div>
        <div className="status-cell"><div className="microlabel">Assets</div><div className="status-value ok">{liveHoldings.length + liveProperties.length + liveOtherAssets.length} tracked</div></div>
        <div className="status-cell"><div className="microlabel">Plans</div><div className="status-value">{openEvents.length} open</div></div>
      </div>

      <section id="current">
        <SectionHeading action={<Tag kind="Verified" />}>Confirm the current snapshot</SectionHeading>
        <p className="mt-2 max-w-3xl text-[0.75rem] text-[var(--ink-soft)]">
          These are dated observations, not a transaction ledger. Change what moved—or simply save the current values to confirm that the picture is still accurate.
        </p>
        <form action={saveCurrentSnapshot} className="mt-3">
          <input type="hidden" name="observationCount" value={observations.length} />
          <div className="table-shell">
            <table className="data-table">
              <thead><tr><th>Class</th><th>Item</th><th>Current / confirmed value</th></tr></thead>
              <tbody>
                {observations.map((row, index) => (
                  <tr key={`${row.type}:${row.id}`}>
                    <td className="microlabel">{row.group}</td>
                    <td>{row.label}</td>
                    <td className="w-56">
                      <input type="hidden" name={`observation-${index}-type`} value={row.type} />
                      <input type="hidden" name={`observation-${index}-id`} value={row.id} />
                      <input className="control" name={`observation-${index}-value`} defaultValue={row.value} inputMode="decimal" required />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <Field label="As of"><input className="control" name="asOf" type="date" max={today} defaultValue={today} required /></Field>
            <Field label="What changed?" help="Optional. Appears in History."><input className="control" name="note" placeholder="Quarterly confirmation / bought a car / closing statement" /></Field>
            <div className="flex items-end"><button className="button-primary w-full" type="submit">Save snapshot</button></div>
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
              <button className="button-primary sm:col-span-2" type="submit">Add account</button>
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
              <button className="button-primary sm:col-span-2" type="submit">Add investment</button>
            </form>
          </details>

          <details className="form-block md:col-span-2">
            <summary>Add property + optional mortgage</summary>
            <form action={createProperty} className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><input className="control" name="name" required /></Field>
              <Field label="Current value"><input className="control" name="value" inputMode="decimal" required /></Field>
              <Field label="Purchase price"><input className="control" name="purchasePrice" inputMode="decimal" /></Field>
              <Field label="Ownership %"><input className="control" name="ownershipPct" inputMode="decimal" defaultValue="100" required /></Field>
              <Field label="Rent / month"><input className="control" name="rentMonthly" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="Costs / month"><input className="control" name="costsMonthly" inputMode="decimal" defaultValue="0" required /></Field>
              <Field label="Valued at"><input className="control" name="valuedAt" type="date" max={today} defaultValue={today} required /></Field>
              <Field label="Mortgage balance"><input className="control" name="mortgageBalance" inputMode="decimal" /></Field>
              <Field label="Mortgage rate"><input className="control" name="mortgageRate" inputMode="decimal" placeholder="0.03" /></Field>
              <Field label="Mortgage payment"><input className="control" name="mortgagePayment" inputMode="decimal" /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isPrimaryResidence" /> Primary residence</label>
              <button className="button-primary sm:col-span-3" type="submit">Add property</button>
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
              <button className="button-primary sm:col-span-2" type="submit">Add other asset</button>
            </form>
          </details>

          <details className="form-block">
            <summary>Add non-mortgage loan</summary>
            <form action={createLoan} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="control" name="name" placeholder="Car loan" required /></Field>
              <Field label="Balance"><input className="control" name="balance" inputMode="decimal" required /></Field>
              <Field label="Rate"><input className="control" name="rate" inputMode="decimal" placeholder="0.05" /></Field>
              <Field label="Payment / month"><input className="control" name="payment" inputMode="decimal" /></Field>
              <button className="button-primary sm:col-span-2" type="submit">Add loan</button>
            </form>
          </details>
        </div>
      </section>

      <section id="inputs">
        <SectionHeading action={<Tag kind="Verified" />}>Planning inputs</SectionHeading>
        <div className="table-shell mt-2">
          <table className="data-table">
            <thead><tr><th>Input</th><th>Meaning</th><th>Value</th><th /></tr></thead>
            <tbody>
              {orderAssumptionRows(assumptionRows).filter((row) => (EDITABLE_ASSUMPTION_KEYS as readonly string[]).includes(row.key)).map((row) => {
                const isDate = row.key === "birthDate";
                return (
                  <tr key={row.key}>
                    <td className="mono">{row.key}</td>
                    <td className="max-w-sm text-[var(--ink-soft)]">{ASSUMPTION_DESCRIPTIONS[row.key as keyof typeof ASSUMPTION_DESCRIPTIONS]}</td>
                    <td>
                      <form action={savePlanningInput} className="flex min-w-56 gap-2">
                        <input type="hidden" name="key" value={row.key} />
                        <input className="control" name="value" type={isDate ? "date" : "text"} defaultValue={row.dateValue ?? row.value ?? ""} required />
                        <button className="button-secondary" type="submit">Save</button>
                      </form>
                    </td>
                    <td className="fine-print">{row.lastReviewedAt ?? "unset"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="plans">
        <SectionHeading>Planned major changes</SectionHeading>
        <div className="mt-2">
          {openEvents.length === 0 ? <p className="text-[var(--ink-soft)]">No open plans.</p> : openEvents.map((event) => (
            <div className="event-row" key={event.id}>
              <time>{event.date}</time>
              <div><strong>{EVENT_LABEL[event.type] ?? event.type}</strong> · {money(event.amount)}{event.note ? <span className="text-[var(--ink-soft)]"> · {event.note}</span> : null}</div>
              <form action={completePlan}><input type="hidden" name="id" value={event.id} /><button className="button-quiet" type="submit">Mark reflected</button></form>
            </div>
          ))}
        </div>
        <details className="form-block">
          <summary>Add future plan</summary>
          <form action={createPlan} className="grid gap-3 sm:grid-cols-3">
            <Field label="Type"><select className="control" name="type">{PLANNED_EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_LABEL[type] ?? type}</option>)}</select></Field>
            <Field label="Expected date"><input className="control" name="date" type="date" required /></Field>
            <Field label="Rough amount"><input className="control" name="amount" inputMode="decimal" required /></Field>
            <Field label="Probability"><input className="control" name="probability" inputMode="decimal" defaultValue="1" required /></Field>
            <Field label="Context"><input className="control" name="note" placeholder="Financing not chosen yet" /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="includedInBaseCase" /> Important to the base plan</label>
            <button className="button-primary sm:col-span-3" type="submit">Add plan</button>
          </form>
        </details>
      </section>
    </PageShell>
  );
}
