"use client";

import { useState, type ReactNode } from "react";
import { ACCOUNT_TYPES, PLANNED_EVENT_TYPES } from "@/shared/setup";
import {
  ASSUMPTION_DESCRIPTIONS,
  EDITABLE_ASSUMPTION_KEYS,
  FEED_ASSUMPTION_KEYS,
  orderAssumptionRows,
  type AssumptionRow,
} from "@/shared/assumptionKeys";
import {
  submitAddAccount,
  submitAddHolding,
  submitAddProperty,
  submitAssumption,
  submitCreateEvent,
  submitDisposeAccount,
  submitDisposeHolding,
  submitDisposeProperty,
  submitRealiseEvent,
} from "./actions";

type AccountOption = { id: string; name: string; type: string; openingAsOf: string };
type HoldingOption = {
  id: string;
  label: string;
  name: string;
  isin: string;
  accountName: string;
};
type PropertyOption = {
  id: string;
  name: string;
  value: string;
  valuedAt: string;
  rentMonthly: string;
  isPrimaryResidence: boolean;
};
type EventOption = {
  id: string;
  type: (typeof PLANNED_EVENT_TYPES)[number];
  date: string;
  amount: string;
  probability: string;
  includedInBaseCase: boolean;
};
type SectionId = "properties" | "accounts" | "assumptions" | "events";

const EVENT_LABEL: Record<string, string> = {
  house_purchase: "house purchase",
  property_sale: "property sale",
  job_exit: "job exit",
  pension_withdrawal: "pension withdrawal",
  rental_start: "rental start",
  inheritance: "inheritance",
};

function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && <p className="field-help">{help}</p>}
    </div>
  );
}

function FormBlock({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-8 border-t border-[var(--hairline)] pt-6">
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm italic leading-6 text-[var(--ink-soft)]">
        {blurb}
      </p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

// The read half of each tab: what's currently saved, above the forms that
// change it. Soft-closed (disposed/realised) rows are filtered server-side.
function CurrentTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm italic text-[var(--ink-soft)]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left">
                {headers.map((header) => (
                  <th key={header} className="py-2 pr-4 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i} className="border-b border-[var(--hairline)]">
                  {cells.map((cell, j) => (
                    <td key={j} className="py-2 pr-4 tabular-nums">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const eur = (value: string) =>
  `€${Number(value).toLocaleString("en-IE", { maximumFractionDigits: 0 })}`;

// Property field set shared by "add property" and the house-purchase
// realisation (with a name prefix).
function PropertyFields({ prefix = "", today }: { prefix?: string; today: string }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Name" htmlFor={`${prefix}name`}>
          <input id={`${prefix}name`} name={`${prefix}name`} className="control" required />
        </Field>
        <Field label="Current value (EUR)" htmlFor={`${prefix}value`}>
          <input id={`${prefix}value`} name={`${prefix}value`} inputMode="decimal" className="control" required />
        </Field>
        <Field label="Valued on" htmlFor={`${prefix}valuedAt`}>
          <input id={`${prefix}valuedAt`} name={`${prefix}valuedAt`} type="date" className="control" max={today} defaultValue={today} required />
        </Field>
        <Field label="Purchase price (EUR)" htmlFor={`${prefix}purchasePrice`} help="Optional — feeds capital-gains estimates; absent means tax shows as unknown.">
          <input id={`${prefix}purchasePrice`} name={`${prefix}purchasePrice`} inputMode="decimal" className="control" />
        </Field>
        <Field label="Ownership %" htmlFor={`${prefix}ownershipPct`}>
          <input id={`${prefix}ownershipPct`} name={`${prefix}ownershipPct`} inputMode="decimal" className="control" defaultValue="100" />
        </Field>
        <Field label="Rent / month (EUR)" htmlFor={`${prefix}rentMonthly`}>
          <input id={`${prefix}rentMonthly`} name={`${prefix}rentMonthly`} inputMode="decimal" className="control" defaultValue="0" />
        </Field>
        <Field label="Costs / month (EUR)" htmlFor={`${prefix}costsMonthly`}>
          <input id={`${prefix}costsMonthly`} name={`${prefix}costsMonthly`} inputMode="decimal" className="control" defaultValue="0" />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" name={`${prefix}isPrimaryResidence`} />
        Primary residence (vivienda habitual)
      </label>
      <div className="mt-5 border-t border-[var(--hairline)] pt-4">
        <div className="eyebrow mb-3">Mortgage (optional)</div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Balance (EUR)" htmlFor={`${prefix}mortgage_balance`} help="Leave empty for no mortgage.">
            <input id={`${prefix}mortgage_balance`} name={`${prefix}mortgage_balance`} inputMode="decimal" className="control" />
          </Field>
          <Field label="Rate" htmlFor={`${prefix}mortgage_rate`} help="e.g. 0.021 for 2.1%">
            <input id={`${prefix}mortgage_rate`} name={`${prefix}mortgage_rate`} inputMode="decimal" className="control" />
          </Field>
          <Field label="Payment / month (EUR)" htmlFor={`${prefix}mortgage_payment`}>
            <input id={`${prefix}mortgage_payment`} name={`${prefix}mortgage_payment`} inputMode="decimal" className="control" />
          </Field>
        </div>
      </div>
    </>
  );
}

export function ManageForms({
  accounts,
  holdings,
  properties,
  events,
  assumptions,
  today,
}: {
  accounts: AccountOption[];
  holdings: HoldingOption[];
  properties: PropertyOption[];
  events: EventOption[];
  assumptions: AssumptionRow[];
  today: string;
}) {
  const [active, setActive] = useState<SectionId>("properties");
  const [lotCount, setLotCount] = useState(0);
  const [realiseId, setRealiseId] = useState<string>(events[0]?.id ?? "");

  const sections: { id: SectionId; label: string }[] = [
    { id: "properties", label: "Properties" },
    { id: "accounts", label: "Accounts" },
    { id: "assumptions", label: "Assumptions" },
    { id: "events", label: "Events" },
  ];

  const realiseEvent = events.find((event) => event.id === realiseId) ?? null;

  return (
    <>
      <div className="mb-6 sm:hidden">
        <label htmlFor="manage-section" className="sr-only">
          Manage section
        </label>
        <select
          id="manage-section"
          value={active}
          onChange={(event) => setActive(event.target.value as SectionId)}
          className="control"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div
        role="tablist"
        aria-label="Manage section"
        className="mb-6 hidden gap-6 border-b border-[var(--ink)] sm:flex"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active === section.id}
            onClick={() => setActive(section.id)}
            className={`font-label -mb-px min-h-11 shrink-0 border-b-2 px-1 text-[0.64rem] font-medium uppercase tracking-[0.2em] transition-colors ${
              active === section.id
                ? "border-[var(--ink)] text-[var(--ink)]"
                : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink)]"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      <section className="card p-5 sm:p-8">
        {active === "properties" && (
          <>
            <CurrentTable
              title="Current properties"
              headers={["Name", "Value", "Valued on", "Rent / month", ""]}
              empty="No properties yet."
              rows={properties.map((property) => [
                property.name,
                eur(property.value),
                property.valuedAt,
                eur(property.rentMonthly),
                property.isPrimaryResidence ? "primary residence" : "",
              ])}
            />
            <FormBlock
              title="Add a property"
              blurb="A property bought (or owned) after the baseline. Its value here is the opening valuation; future appraisals re-anchor it."
            >
              <form action={submitAddProperty} className="grid gap-5">
                <PropertyFields today={today} />
                <div className="flex justify-end">
                  <button type="submit" className="button-primary">
                    Add property
                  </button>
                </div>
              </form>
            </FormBlock>

            {properties.length > 0 && (
              <FormBlock
                title="Sell / dispose a property"
                blurb="One transaction: the proceeds land as a deposit (an ordinary ledger row) and the property and its mortgages soft-close. Nothing is deleted — history and provenance survive."
              >
                <form action={submitDisposeProperty} className="grid gap-5 sm:grid-cols-2">
                  <Field label="Property" htmlFor="dp-property">
                    <select id="dp-property" name="propertyId" className="control">
                      {properties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Proceeds into" htmlFor="dp-account">
                    <select id="dp-account" name="proceedsAccountId" className="control">
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.type})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Net proceeds (EUR)" htmlFor="dp-amount" help="What actually arrived after costs and mortgage repayment.">
                    <input id="dp-amount" name="amount" inputMode="decimal" className="control" required />
                  </Field>
                  <Field label="Date" htmlFor="dp-date">
                    <input id="dp-date" name="occurredAt" type="date" className="control" max={today} defaultValue={today} required />
                  </Field>
                  <Field label="Note" htmlFor="dp-note">
                    <input id="dp-note" name="note" className="control" />
                  </Field>
                  <div className="flex items-end justify-end">
                    <button type="submit" className="button-primary">
                      Sell property
                    </button>
                  </div>
                </form>
              </FormBlock>
            )}
          </>
        )}

        {active === "accounts" && (
          <>
            <div className="grid gap-8">
              <CurrentTable
                title="Current accounts"
                headers={["Name", "Type", "Opened"]}
                empty="No accounts yet."
                rows={accounts.map((account) => [
                  account.name,
                  account.type,
                  account.openingAsOf,
                ])}
              />
              <CurrentTable
                title="Current holdings"
                headers={["Ticker / name", "ISIN", "Account"]}
                empty="No holdings yet."
                rows={holdings.map((holding) => [
                  holding.label,
                  holding.isin,
                  holding.accountName,
                ])}
              />
            </div>
            <FormBlock
              title="Add an account"
              blurb="An account opened after the baseline carries its own opening date — movements before it are rejected."
            >
              <form action={submitAddAccount} className="grid gap-5 sm:grid-cols-4">
                <Field label="Type" htmlFor="aa-type">
                  <select id="aa-type" name="type" className="control">
                    {ACCOUNT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Name" htmlFor="aa-name">
                  <input id="aa-name" name="name" className="control" required />
                </Field>
                <Field label="Opening cash (EUR)" htmlFor="aa-cash">
                  <input id="aa-cash" name="openingCash" inputMode="decimal" className="control" defaultValue="0" />
                </Field>
                <Field label="Opens on" htmlFor="aa-date">
                  <input id="aa-date" name="openingAsOf" type="date" className="control" max={today} defaultValue={today} required />
                </Field>
                <div className="flex items-end justify-end sm:col-span-4">
                  <button type="submit" className="button-primary">
                    Add account
                  </button>
                </div>
              </form>
            </FormBlock>

            <FormBlock
              title="Add a holding"
              blurb="A new position in an existing account. Start it at quantity 0 and log the buy via Quick-log, or enter an opening quantity with its open lots for FIFO basis."
            >
              <form action={submitAddHolding} className="grid gap-5">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Account" htmlFor="ah-account">
                    <select id="ah-account" name="accountId" className="control">
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.type})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Name" htmlFor="ah-name">
                    <input id="ah-name" name="name" className="control" required />
                  </Field>
                  <Field label="ISIN" htmlFor="ah-isin">
                    <input id="ah-isin" name="isin" className="control" required />
                  </Field>
                  <Field label="Feed ticker" htmlFor="ah-ticker" help="Leave empty only for unpriced assets.">
                    <input id="ah-ticker" name="ticker" className="control" />
                  </Field>
                  <Field label="Currency" htmlFor="ah-ccy">
                    <input id="ah-ccy" name="currency" className="control" defaultValue="EUR" />
                  </Field>
                  <Field label="Opening quantity" htmlFor="ah-qty">
                    <input id="ah-qty" name="openingQuantity" inputMode="decimal" className="control" defaultValue="0" />
                  </Field>
                  <Field label="Opens on" htmlFor="ah-date">
                    <input id="ah-date" name="openingAsOf" type="date" className="control" max={today} defaultValue={today} required />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="acknowledgeUnpriced" />
                  No feed ticker — I understand this position will be unpriced.
                </label>

                <input type="hidden" name="lotCount" value={lotCount} />
                {Array.from({ length: lotCount }).map((_, i) => (
                  <div key={i} className="grid gap-3 border border-[var(--hairline)] bg-[var(--paper-deep)] p-3 sm:grid-cols-5">
                    <Field label="Buy date" htmlFor={`lot-${i}-buyDate`}>
                      <input id={`lot-${i}-buyDate`} name={`lot-${i}-buyDate`} type="date" max={today} className="control" />
                    </Field>
                    <Field label="Quantity" htmlFor={`lot-${i}-quantity`}>
                      <input id={`lot-${i}-quantity`} name={`lot-${i}-quantity`} inputMode="decimal" className="control" />
                    </Field>
                    <Field label="Price" htmlFor={`lot-${i}-price`}>
                      <input id={`lot-${i}-price`} name={`lot-${i}-price`} inputMode="decimal" className="control" />
                    </Field>
                    <Field label="Fees (EUR)" htmlFor={`lot-${i}-fees`}>
                      <input id={`lot-${i}-fees`} name={`lot-${i}-fees`} inputMode="decimal" className="control" defaultValue="0" />
                    </Field>
                    <Field label="FX → EUR" htmlFor={`lot-${i}-fxRate`}>
                      <input id={`lot-${i}-fxRate`} name={`lot-${i}-fxRate`} inputMode="decimal" className="control" defaultValue="1" />
                    </Field>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="button-secondary text-xs"
                    onClick={() => setLotCount(lotCount + 1)}
                  >
                    + Add open lot
                  </button>
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="button-primary">
                    Add holding
                  </button>
                </div>
              </form>
            </FormBlock>

            {holdings.length > 0 && (
              <FormBlock
                title="Dispose a holding"
                blurb="Only at exactly zero quantity — log the sale first. The position soft-closes; its lots and history remain."
              >
                <form action={submitDisposeHolding} className="flex flex-wrap items-end gap-4">
                  <Field label="Holding" htmlFor="dh-holding">
                    <select id="dh-holding" name="holdingId" className="control">
                      {holdings.map((holding) => (
                        <option key={holding.id} value={holding.id}>
                          {holding.label} — {holding.accountName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button type="submit" className="button-secondary">
                    Dispose holding
                  </button>
                </form>
              </FormBlock>
            )}

            <FormBlock
              title="Close an account"
              blurb="Only at exactly zero cash and no live holdings — a closed account leaves the calculation entirely, so anything left in it would vanish. Transfer the cash out first."
            >
              <form action={submitDisposeAccount} className="flex flex-wrap items-end gap-4">
                <Field label="Account" htmlFor="da-account">
                  <select id="da-account" name="accountId" className="control">
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type})
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" className="button-secondary">
                  Close account
                </button>
              </form>
            </FormBlock>
          </>
        )}

        {active === "assumptions" && (
          <div>
            <p className="max-w-2xl text-sm italic leading-6 text-[var(--ink-soft)]">
              Coarse figures, reviewed yearly. Saving replaces the previous
              value (an upsert — no history yet) and resets the review clock.
            </p>
            {orderAssumptionRows(assumptions).map((assumption) => {
              const current = assumption.value ?? assumption.dateValue;
              const editable = (
                EDITABLE_ASSUMPTION_KEYS as readonly string[]
              ).includes(assumption.key);
              const isDate = assumption.key === "birthDate";
              const isFeed = (FEED_ASSUMPTION_KEYS as readonly string[]).includes(
                assumption.key,
              );
              const description =
                ASSUMPTION_DESCRIPTIONS[
                  assumption.key as keyof typeof ASSUMPTION_DESCRIPTIONS
                ];
              const row = (
                <>
                  <div className="min-w-56 flex-1">
                    <div className="flex items-baseline gap-2 text-sm font-medium">
                      {assumption.key}
                      {isFeed && (
                        <span className="font-label text-[0.58rem] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                          auto · ECB
                        </span>
                      )}
                    </div>
                    {description && (
                      <p className="mt-1 max-w-md text-xs leading-5 text-[var(--ink-soft)]">
                        {description}
                      </p>
                    )}
                    <p className="mt-1 text-xs tabular-nums text-[var(--ink-faint)]">
                      reviewed {assumption.lastReviewedAt ?? "never"}
                    </p>
                  </div>
                  {editable ? (
                    <>
                      <div className="w-40">
                        <label className="sr-only" htmlFor={`as-${assumption.key}`}>
                          {assumption.key}
                        </label>
                        <input
                          id={`as-${assumption.key}`}
                          name="value"
                          type={isDate ? "date" : "text"}
                          inputMode={isDate ? undefined : "decimal"}
                          max={isDate ? today : undefined}
                          className="control"
                          defaultValue={current ?? ""}
                          placeholder={current === null ? "not set" : undefined}
                          required
                        />
                      </div>
                      <button type="submit" className="button-secondary">
                        Save
                      </button>
                    </>
                  ) : (
                    <div className="tabular-nums text-sm">
                      {current ?? (
                        <span className="italic text-[var(--ink-soft)]">not set</span>
                      )}
                    </div>
                  )}
                </>
              );
              return editable ? (
                <form
                  key={assumption.key}
                  action={submitAssumption}
                  className="flex flex-wrap items-center gap-4 border-b border-[var(--hairline)] py-4"
                >
                  <input type="hidden" name="key" value={assumption.key} />
                  {row}
                </form>
              ) : (
                <div
                  key={assumption.key}
                  className="flex flex-wrap items-center gap-4 border-b border-[var(--hairline)] py-4"
                >
                  {row}
                </div>
              );
            })}
          </div>
        )}

        {active === "events" && (
          <>
            <CurrentTable
              title="Open planned events"
              headers={["Event", "Expected", "Amount", "Probability", ""]}
              empty="No open planned events."
              rows={events.map((event) => [
                EVENT_LABEL[event.type],
                event.date,
                eur(event.amount),
                event.probability,
                event.includedInBaseCase ? "in base case" : "",
              ])}
            />
            <FormBlock
              title="Add a planned event"
              blurb="A forecast, not a fact — it never moves today's net worth; scenarios consume it. Inheritances stay out of the base case on purpose."
            >
              <form action={submitCreateEvent} className="grid gap-5 sm:grid-cols-4">
                <Field label="Type" htmlFor="pe-type">
                  <select id="pe-type" name="type" className="control">
                    {PLANNED_EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {EVENT_LABEL[type]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Expected date" htmlFor="pe-date">
                  <input id="pe-date" name="date" type="date" className="control" required />
                </Field>
                <Field label="Amount (EUR)" htmlFor="pe-amount">
                  <input id="pe-amount" name="amount" inputMode="decimal" className="control" required />
                </Field>
                <Field label="Probability" htmlFor="pe-prob" help="0–1">
                  <input id="pe-prob" name="probability" inputMode="decimal" className="control" defaultValue="1" />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="includedInBaseCase" />
                  Include in the base case
                </label>
                <div className="flex items-end justify-end sm:col-span-2">
                  <button type="submit" className="button-primary">
                    Add event
                  </button>
                </div>
              </form>
            </FormBlock>

            {events.length > 0 && (
              <FormBlock
                title="Realise an event"
                blurb="A forecast becomes facts only here, explicitly: each type states exactly what it writes — and you confirm the figures. The resulting ledger rows keep a link back to the forecast."
              >
                <form action={submitRealiseEvent} className="grid gap-5">
                  <Field label="Event" htmlFor="re-event">
                    <select
                      id="re-event"
                      name="plannedEventId"
                      className="control"
                      value={realiseId}
                      onChange={(e) => setRealiseId(e.target.value)}
                    >
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {EVENT_LABEL[event.type]} — {event.date} — €{event.amount}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {realiseEvent && (
                    <input type="hidden" name="type" value={realiseEvent.type} />
                  )}

                  {realiseEvent?.type === "inheritance" && (
                    <div className="grid gap-5 sm:grid-cols-3">
                      <Field label="Deposit into" htmlFor="re-account">
                        <select id="re-account" name="accountId" className="control">
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({account.type})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Actual amount (EUR)" htmlFor="re-amount">
                        <input
                          id="re-amount"
                          name="amount"
                          inputMode="decimal"
                          className="control"
                          defaultValue={realiseEvent.amount}
                          required
                        />
                      </Field>
                      <Field label="Date" htmlFor="re-date">
                        <input id="re-date" name="occurredAt" type="date" className="control" max={today} defaultValue={today} required />
                      </Field>
                    </div>
                  )}

                  {realiseEvent?.type === "pension_withdrawal" && (
                    <div className="grid gap-5 sm:grid-cols-4">
                      <Field label="Withdraw from" htmlFor="re-from" help="Both legs land atomically — the pension is actually drawn down.">
                        <select id="re-from" name="fromAccountId" className="control">
                          {accounts
                            .filter((account) => account.type === "pension")
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} ({account.type})
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Into" htmlFor="re-to">
                        <select id="re-to" name="toAccountId" className="control">
                          {accounts
                            .filter((account) => account.type !== "pension")
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} ({account.type})
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Actual amount (EUR)" htmlFor="re-amount">
                        <input
                          id="re-amount"
                          name="amount"
                          inputMode="decimal"
                          className="control"
                          defaultValue={realiseEvent.amount}
                          required
                        />
                      </Field>
                      <Field label="Date" htmlFor="re-date">
                        <input id="re-date" name="occurredAt" type="date" className="control" max={today} defaultValue={today} required />
                      </Field>
                    </div>
                  )}

                  {realiseEvent?.type === "house_purchase" && (
                    <>
                      <div className="grid gap-5 sm:grid-cols-3">
                        <Field label="Paid from" htmlFor="re-account">
                          <select id="re-account" name="accountId" className="control">
                            {accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} ({account.type})
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Cash paid (EUR)" htmlFor="re-amount" help="The withdrawal — down payment plus costs.">
                          <input id="re-amount" name="amount" inputMode="decimal" className="control" required />
                        </Field>
                        <Field label="Date" htmlFor="re-date">
                          <input id="re-date" name="occurredAt" type="date" className="control" max={today} defaultValue={today} required />
                        </Field>
                      </div>
                      <div className="border border-[var(--hairline)] bg-[var(--paper-deep)] p-4">
                        <div className="eyebrow mb-3">The property</div>
                        <PropertyFields prefix="prop_" today={today} />
                      </div>
                    </>
                  )}

                  {realiseEvent?.type === "property_sale" && (
                    <div className="grid gap-5 sm:grid-cols-4">
                      <Field label="Property" htmlFor="re-property">
                        <select id="re-property" name="propertyId" className="control">
                          {properties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {property.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Proceeds into" htmlFor="re-paccount">
                        <select id="re-paccount" name="proceedsAccountId" className="control">
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({account.type})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Net proceeds (EUR)" htmlFor="re-amount">
                        <input id="re-amount" name="amount" inputMode="decimal" className="control" required />
                      </Field>
                      <Field label="Date" htmlFor="re-date">
                        <input id="re-date" name="occurredAt" type="date" className="control" max={today} defaultValue={today} required />
                      </Field>
                    </div>
                  )}

                  {realiseEvent?.type === "rental_start" && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Property" htmlFor="re-property">
                        <select id="re-property" name="propertyId" className="control">
                          {properties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {property.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Rent / month (EUR)" htmlFor="re-rent">
                        <input id="re-rent" name="rentMonthly" inputMode="decimal" className="control" required />
                      </Field>
                    </div>
                  )}

                  {realiseEvent?.type === "job_exit" && (
                    <p className="notice notice-amber text-sm leading-6">
                      No ledger row — leaving the job moves no money by itself.
                      After realising, review the spend and return assumptions;
                      the status engine reacts to those.
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button type="submit" className="button-primary">
                      Realise event
                    </button>
                  </div>
                </form>
              </FormBlock>
            )}
          </>
        )}
      </section>
    </>
  );
}
