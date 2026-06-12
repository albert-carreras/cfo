"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MOVEMENT_TYPES } from "@/shared/quicklog";
import {
  submitMonthlySpend,
  submitMovement,
  submitRevaluation,
  submitTransfer,
} from "./actions";

type AccountOption = {
  id: string;
  name: string;
  type: string;
};

type HoldingOption = {
  id: string;
  label: string;
};

type TabId = "movement" | "transfer" | "pension" | "spend";

type Tab = {
  id: TabId;
  label: string;
};

const movementLabel = (type: (typeof MOVEMENT_TYPES)[number]) =>
  type === "transfer" ? "transfer in" : type;

function Field({
  label,
  htmlFor,
  help,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && <p className="field-help">{help}</p>}
    </div>
  );
}

function FormIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-7 border-b border-[var(--hairline)] pb-6">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="font-display mt-2 text-3xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm italic leading-6 text-[var(--ink-soft)]">
        {children}
      </p>
    </div>
  );
}

export function QuickLogForms({
  accounts,
  holdings,
  pensions,
  today,
  thisMonth,
}: {
  accounts: AccountOption[];
  holdings: HoldingOption[];
  pensions: AccountOption[];
  today: string;
  thisMonth: string;
}) {
  const tabs: Tab[] = [
    { id: "movement", label: "Movement" },
    { id: "transfer", label: "Transfer" },
    ...(pensions.length > 0
      ? ([{ id: "pension", label: "Pension" }] satisfies Tab[])
      : []),
    { id: "spend", label: "Monthly spend" },
  ];
  const [active, setActive] = useState<TabId>("movement");
  const [movementType, setMovementType] =
    useState<(typeof MOVEMENT_TYPES)[number]>("deposit");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tradesHolding = movementType === "buy" || movementType === "sell";

  function selectTab(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    setActive(tab.id);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab((index + 1) % tabs.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(tabs.length - 1);
    }
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Quick-log operation"
        className="mb-6 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-[var(--ink)]"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`quick-log-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`quick-log-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            className={`font-label -mb-px min-h-11 shrink-0 border-b-2 px-1 text-[0.64rem] font-medium uppercase tracking-[0.2em] transition-colors ${
              active === tab.id
                ? "border-[var(--ink)] text-[var(--ink)]"
                : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id={`quick-log-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`quick-log-tab-${active}`}
        className="card p-5 sm:p-8"
      >
        {active === "movement" && (
          <>
            <FormIntro eyebrow="Append to ledger" title="Record a movement">
              Deposits, withdrawals, trades, dividends, fees, and expenses. For
              money moving between your own accounts, use Transfer.
            </FormIntro>
            <form action={submitMovement} className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Type" htmlFor="type">
                  <select
                    id="type"
                    name="type"
                    className="control"
                    value={movementType}
                    onChange={(event) =>
                      setMovementType(
                        event.target.value as (typeof MOVEMENT_TYPES)[number],
                      )
                    }
                  >
                    {MOVEMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {movementLabel(type)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Account" htmlFor="accountId">
                  <select id="accountId" name="accountId" className="control">
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {movementType === "transfer" && (
                <p className="notice notice-amber text-xs leading-5">
                  “Transfer in” is for money arriving from outside. Use the
                  Transfer tab for money moving between your own accounts.
                </p>
              )}

              {tradesHolding && (
                <div className="grid gap-5 border border-[var(--hairline)] bg-[var(--paper-deep)] p-4 sm:grid-cols-2">
                  <Field label="Holding" htmlFor="holdingId">
                    <select
                      id="holdingId"
                      name="holdingId"
                      className="control"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Select a holding
                      </option>
                      {holdings.map((holding) => (
                        <option key={holding.id} value={holding.id}>
                          {holding.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" htmlFor="quantity">
                    <input
                      id="quantity"
                      name="quantity"
                      inputMode="decimal"
                      className="control"
                      placeholder="10"
                      required
                    />
                  </Field>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Amount (EUR)" htmlFor="amount">
                  <input
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    className="control"
                    placeholder="1000"
                    required
                  />
                </Field>
                <Field label="Date" htmlFor="occurredAt">
                  <input
                    id="occurredAt"
                    name="occurredAt"
                    type="date"
                    className="control"
                    defaultValue={today}
                  />
                </Field>
              </div>

              <Field label="Note" htmlFor="note">
                <input
                  id="note"
                  name="note"
                  className="control"
                  placeholder="Optional context"
                />
              </Field>

              <div className="flex justify-end pt-2">
                <button type="submit" className="button-primary">
                  Append movement
                </button>
              </div>
            </form>
          </>
        )}

        {active === "transfer" && (
          <>
            <FormIntro eyebrow="Atomic transfer" title="Move money between accounts">
              Writes the withdrawal and deposit together, so an internal
              transfer can never create or destroy money.
            </FormIntro>
            <form action={submitTransfer} className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="From" htmlFor="fromAccountId">
                  <select
                    id="fromAccountId"
                    name="fromAccountId"
                    className="control"
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="To" htmlFor="toAccountId">
                  <select
                    id="toAccountId"
                    name="toAccountId"
                    className="control"
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.type})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Amount (EUR)" htmlFor="transfer-amount">
                  <input
                    id="transfer-amount"
                    name="amount"
                    inputMode="decimal"
                    className="control"
                    placeholder="1000"
                    required
                  />
                </Field>
                <Field label="Date" htmlFor="transfer-occurredAt">
                  <input
                    id="transfer-occurredAt"
                    name="occurredAt"
                    type="date"
                    className="control"
                    defaultValue={today}
                  />
                </Field>
              </div>
              <Field label="Note" htmlFor="transfer-note">
                <input
                  id="transfer-note"
                  name="note"
                  className="control"
                  placeholder="Optional context"
                />
              </Field>
              <div className="flex justify-end pt-2">
                <button type="submit" className="button-primary">
                  Append transfer
                </button>
              </div>
            </form>
          </>
        )}

        {active === "pension" && pensions.length > 0 && (
          <>
            <FormIntro eyebrow="Dated valuation" title="Add a pension statement">
              The account re-anchors to this value. A wrong entry is corrected
              by appending a newer statement, never by editing history.
            </FormIntro>
            <form action={submitRevaluation} className="grid gap-5">
              <Field label="Pension account" htmlFor="revaluation-accountId">
                <select
                  id="revaluation-accountId"
                  name="accountId"
                  className="control"
                >
                  {pensions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Statement value (EUR)"
                  htmlFor="revaluation-value"
                >
                  <input
                    id="revaluation-value"
                    name="value"
                    inputMode="decimal"
                    className="control"
                    placeholder="85000"
                    required
                  />
                </Field>
                <Field label="Statement date" htmlFor="revaluation-valuedAt">
                  <input
                    id="revaluation-valuedAt"
                    name="valuedAt"
                    type="date"
                    className="control"
                    defaultValue={today}
                  />
                </Field>
              </div>
              <Field label="Note" htmlFor="revaluation-note">
                <input
                  id="revaluation-note"
                  name="note"
                  className="control"
                  placeholder="Optional context"
                />
              </Field>
              <div className="flex justify-end pt-2">
                <button type="submit" className="button-primary">
                  Append statement
                </button>
              </div>
            </form>
          </>
        )}

        {active === "spend" && (
          <>
            <FormIntro eyebrow="Optional calibration" title="Log monthly spend">
              Runway uses the coarse annual assumption. This optional entry only
              cross-checks it, so a quiet ledger remains acceptable.
            </FormIntro>
            <form action={submitMonthlySpend} className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Month" htmlFor="month">
                  <input
                    id="month"
                    name="month"
                    type="month"
                    className="control"
                    defaultValue={thisMonth}
                  />
                </Field>
                <Field label="Amount (EUR)" htmlFor="spend-amount">
                  <input
                    id="spend-amount"
                    name="amount"
                    inputMode="decimal"
                    className="control"
                    placeholder="3000"
                    required
                  />
                </Field>
              </div>
              <Field label="Note" htmlFor="spend-note">
                <input
                  id="spend-note"
                  name="note"
                  className="control"
                  placeholder="Optional context"
                />
              </Field>
              <div className="flex justify-end pt-2">
                <button type="submit" className="button-primary">
                  Log monthly spend
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </>
  );
}
