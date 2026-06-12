"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNT_TYPES,
  PLANNED_EVENT_TYPES,
  setupInputSchema,
  setupWarnings,
  validateSetupDates,
} from "@/shared/setup";
import { submitSetup } from "./actions";

// Multi-step first-run wizard. All state lives here until the final commit —
// nothing is written step by step, so abandoning halfway leaves the database
// untouched. Validation on review uses the exact schema the server commits
// with (src/shared/setup.ts).

type AccountDraft = {
  type: (typeof ACCOUNT_TYPES)[number];
  name: string;
  openingCash: string;
};

type LotDraft = {
  buyDate: string;
  quantity: string;
  price: string;
  fees: string;
  fxRate: string;
};

type HoldingDraft = {
  accountIndex: number;
  isin: string;
  ticker: string;
  name: string;
  currency: string;
  openingQuantity: string;
  acknowledgeUnpriced: boolean;
  lots: LotDraft[];
};

type PropertyDraft = {
  name: string;
  value: string;
  purchasePrice: string;
  ownershipPct: string;
  rentMonthly: string;
  costsMonthly: string;
  isPrimaryResidence: boolean;
  valuedAt: string;
};

type LiabilityDraft = {
  propertyIndex: number | null;
  rate: string;
  balance: string;
  payment: string;
};

type EventDraft = {
  type: (typeof PLANNED_EVENT_TYPES)[number];
  date: string;
  amount: string;
  probability: string;
  includedInBaseCase: boolean;
  note: string;
};

type AssumptionDrafts = {
  monthlySpend: string;
  monthlySpendConservative: string;
  monthlySpendOptimistic: string;
  safeWithdrawalRate: string;
  expectedReturn: string;
  longRunInflation: string;
  birthDate: string;
};

const STEPS = [
  "Baseline",
  "Accounts",
  "Holdings",
  "Properties",
  "Assumptions",
  "Planned events",
  "Review",
] as const;

const EVENT_LABEL: Record<(typeof PLANNED_EVENT_TYPES)[number], string> = {
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

function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-7 border-b border-[var(--hairline)] pb-6">
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm italic leading-6 text-[var(--ink-soft)]">
        {children}
      </p>
    </div>
  );
}

function RowCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border border-[var(--hairline)] bg-[var(--paper-deep)] p-4">
      <div className="mb-4 flex items-center justify-between border-b border-[var(--hairline)] pb-2">
        <div className="eyebrow">{title}</div>
        <button
          type="button"
          onClick={onRemove}
          className="button-quiet text-xs"
        >
          Remove
        </button>
      </div>
      {children}
    </div>
  );
}

export function SetupWizard({ today }: { today: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [baselineAsOf, setBaselineAsOf] = useState(today);
  const [accounts, setAccounts] = useState<AccountDraft[]>([
    { type: "bank", name: "", openingCash: "0" },
  ]);
  const [holdings, setHoldings] = useState<HoldingDraft[]>([]);
  const [properties, setProperties] = useState<PropertyDraft[]>([]);
  const [liabilities, setLiabilities] = useState<LiabilityDraft[]>([]);
  const [events, setEvents] = useState<EventDraft[]>([]);
  const [assumption, setAssumption] = useState<AssumptionDrafts>({
    monthlySpend: "",
    monthlySpendConservative: "",
    monthlySpendOptimistic: "",
    safeWithdrawalRate: "0.035",
    expectedReturn: "0.07",
    longRunInflation: "0.02",
    birthDate: "",
  });

  function update<T>(
    list: T[],
    set: (next: T[]) => void,
    index: number,
    patch: Partial<T>,
  ) {
    set(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove<T>(list: T[], set: (next: T[]) => void, index: number) {
    set(list.filter((_, i) => i !== index));
  }

  // The wizard state → the server's input contract. Empty strings become
  // omissions; numeric assumption drafts become assumption rows.
  function buildInput() {
    const assumptionRows: {
      key: string;
      value?: string | null;
      dateValue?: string | null;
    }[] = [];
    const numericKeys = [
      "monthlySpend",
      "monthlySpendConservative",
      "monthlySpendOptimistic",
      "safeWithdrawalRate",
      "expectedReturn",
      "longRunInflation",
    ] as const;
    for (const key of numericKeys) {
      if (assumption[key].trim() !== "") {
        assumptionRows.push({ key, value: assumption[key].trim() });
      }
    }
    if (assumption.birthDate.trim() !== "") {
      assumptionRows.push({
        key: "birthDate",
        dateValue: assumption.birthDate.trim(),
      });
    }

    return {
      baselineAsOf,
      accounts: accounts.map((account) => ({
        type: account.type,
        name: account.name,
        openingCash: account.openingCash || "0",
      })),
      holdings: holdings.map((holding) => ({
        accountIndex: holding.accountIndex,
        isin: holding.isin,
        ticker: holding.ticker.trim() === "" ? null : holding.ticker.trim(),
        name: holding.name,
        currency: holding.currency || "EUR",
        openingQuantity: holding.openingQuantity || "0",
        acknowledgeUnpriced: holding.acknowledgeUnpriced,
        lots: holding.lots.map((lot) => ({
          buyDate: lot.buyDate,
          quantity: lot.quantity,
          price: lot.price,
          fees: lot.fees || "0",
          fxRate: lot.fxRate || "1",
        })),
      })),
      properties: properties.map((property) => ({
        name: property.name,
        value: property.value,
        purchasePrice:
          property.purchasePrice.trim() === "" ? null : property.purchasePrice,
        ownershipPct: property.ownershipPct || "100",
        rentMonthly: property.rentMonthly || "0",
        costsMonthly: property.costsMonthly || "0",
        isPrimaryResidence: property.isPrimaryResidence,
        valuedAt: property.valuedAt || baselineAsOf,
      })),
      liabilities: liabilities.map((liability) => ({
        propertyIndex: liability.propertyIndex,
        rate: liability.rate.trim() === "" ? null : liability.rate,
        balance: liability.balance,
        payment: liability.payment.trim() === "" ? null : liability.payment,
      })),
      assumptions: assumptionRows,
      plannedEvents: events.map((event) => ({
        type: event.type,
        date: event.date,
        amount: event.amount,
        probability: event.probability || "1",
        includedInBaseCase: event.includedInBaseCase,
        note: event.note.trim() === "" ? null : event.note,
      })),
    };
  }

  // Review-step validation with the exact server schema + date rules.
  const review = useMemo(() => {
    if (step !== STEPS.length - 1) return null;
    const input = buildInput();
    const parsed = setupInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        errors: parsed.error.issues.map((issue) =>
          issue.path.length > 0
            ? `${issue.path.join(".")}: ${issue.message}`
            : issue.message,
        ),
        warnings: [] as string[],
        input,
      };
    }
    return {
      errors: validateSetupDates(parsed.data, today),
      warnings: setupWarnings(parsed.data),
      input,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, baselineAsOf, accounts, holdings, properties, liabilities, events, assumption, today]);

  async function commit() {
    setSubmitting(true);
    setServerError(null);
    const result = await submitSetup(buildInput());
    if (result.ok) {
      router.push("/");
      return;
    }
    setServerError(result.error);
    setSubmitting(false);
  }

  return (
    <div>
      {/* Step rail */}
      <ol className="mb-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-[var(--ink)] pb-3">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={`font-label text-[0.64rem] font-medium uppercase tracking-[0.2em] ${
                i === step
                  ? "text-[var(--ink)]"
                  : i < step
                    ? "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    : "text-[var(--ink-faint)]"
              }`}
              disabled={i > step}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      <section className="card p-5 sm:p-8">
        {step === 0 && (
          <>
            <StepIntro title="Baseline date">
              The dated line everything starts from: current state = these
              opening balances + every movement you log after this date.
              Usually today, or the date of the statements you are copying
              from.
            </StepIntro>
            <Field label="Baseline date" htmlFor="baselineAsOf">
              <input
                id="baselineAsOf"
                type="date"
                className="control"
                value={baselineAsOf}
                max={today}
                onChange={(e) => setBaselineAsOf(e.target.value)}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <StepIntro title="Accounts">
              Bank, broker, and pension accounts with their cash balance on the
              baseline date. Cash is EUR. A pension&apos;s balance is its latest
              statement value — you&apos;ll re-anchor it with new statements
              later.
            </StepIntro>
            <div className="grid gap-4">
              {accounts.map((account, i) => (
                <RowCard
                  key={i}
                  title={`Account ${i + 1}`}
                  onRemove={() => remove(accounts, setAccounts, i)}
                >
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field label="Type" htmlFor={`acc-type-${i}`}>
                      <select
                        id={`acc-type-${i}`}
                        className="control"
                        value={account.type}
                        onChange={(e) =>
                          update(accounts, setAccounts, i, {
                            type: e.target.value as AccountDraft["type"],
                          })
                        }
                      >
                        {ACCOUNT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Name" htmlFor={`acc-name-${i}`}>
                      <input
                        id={`acc-name-${i}`}
                        className="control"
                        placeholder="Bank — current account"
                        value={account.name}
                        onChange={(e) =>
                          update(accounts, setAccounts, i, {
                            name: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Opening cash (EUR)"
                      htmlFor={`acc-cash-${i}`}
                    >
                      <input
                        id={`acc-cash-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={account.openingCash}
                        onChange={(e) =>
                          update(accounts, setAccounts, i, {
                            openingCash: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                </RowCard>
              ))}
            </div>
            <button
              type="button"
              className="button-secondary mt-5"
              onClick={() =>
                setAccounts([
                  ...accounts,
                  { type: "bank", name: "", openingCash: "0" },
                ])
              }
            >
              + Add account
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <StepIntro title="Holdings & open lots">
              Positions you hold at the baseline, per account. The ticker is
              the feed symbol used for daily prices (e.g. VWCE.DE on Yahoo).
              Open lots are the purchases you still hold — they give future
              sales their FIFO cost basis for Spanish capital gains; without
              them, tax on a sale shows as basis-incomplete.
            </StepIntro>
            {accounts.length === 0 ? (
              <p className="notice notice-amber text-sm">
                Add an account first — holdings live inside accounts.
              </p>
            ) : (
              <>
                <div className="grid gap-4">
                  {holdings.map((holding, i) => (
                    <RowCard
                      key={i}
                      title={`Holding ${i + 1}`}
                      onRemove={() => remove(holdings, setHoldings, i)}
                    >
                      <div className="grid gap-5 sm:grid-cols-3">
                        <Field label="Account" htmlFor={`hold-acc-${i}`}>
                          <select
                            id={`hold-acc-${i}`}
                            className="control"
                            value={holding.accountIndex}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                accountIndex: Number(e.target.value),
                              })
                            }
                          >
                            {accounts.map((account, ai) => (
                              <option key={ai} value={ai}>
                                {account.name || `Account ${ai + 1}`}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Name" htmlFor={`hold-name-${i}`}>
                          <input
                            id={`hold-name-${i}`}
                            className="control"
                            placeholder="Vanguard FTSE All-World"
                            value={holding.name}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                name: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="ISIN" htmlFor={`hold-isin-${i}`}>
                          <input
                            id={`hold-isin-${i}`}
                            className="control"
                            placeholder="IE00BK5BQT80"
                            value={holding.isin}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                isin: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field
                          label="Feed ticker"
                          htmlFor={`hold-ticker-${i}`}
                          help="The market-feed symbol. Leave empty only for unpriced assets."
                        >
                          <input
                            id={`hold-ticker-${i}`}
                            className="control"
                            placeholder="VWCE.DE"
                            value={holding.ticker}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                ticker: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Currency" htmlFor={`hold-ccy-${i}`}>
                          <input
                            id={`hold-ccy-${i}`}
                            className="control"
                            value={holding.currency}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                currency: e.target.value.toUpperCase(),
                              })
                            }
                          />
                        </Field>
                        <Field label="Quantity" htmlFor={`hold-qty-${i}`}>
                          <input
                            id={`hold-qty-${i}`}
                            inputMode="decimal"
                            className="control"
                            value={holding.openingQuantity}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                openingQuantity: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                      {holding.ticker.trim() === "" && (
                        <label className="mt-4 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={holding.acknowledgeUnpriced}
                            onChange={(e) =>
                              update(holdings, setHoldings, i, {
                                acknowledgeUnpriced: e.target.checked,
                              })
                            }
                          />
                          No feed ticker — I understand this position will be
                          unpriced until one is set.
                        </label>
                      )}

                      <div className="mt-5 border-t border-[var(--hairline)] pt-4">
                        <div className="eyebrow mb-3">Open lots</div>
                        <div className="grid gap-3">
                          {holding.lots.map((lot, li) => (
                            <div
                              key={li}
                              className="grid gap-3 sm:grid-cols-6"
                            >
                              <Field label="Buy date" htmlFor={`lot-date-${i}-${li}`}>
                                <input
                                  id={`lot-date-${i}-${li}`}
                                  type="date"
                                  className="control"
                                  max={today}
                                  value={lot.buyDate}
                                  onChange={(e) => {
                                    const lots = holding.lots.map((l, x) =>
                                      x === li ? { ...l, buyDate: e.target.value } : l,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                />
                              </Field>
                              <Field label="Quantity" htmlFor={`lot-qty-${i}-${li}`}>
                                <input
                                  id={`lot-qty-${i}-${li}`}
                                  inputMode="decimal"
                                  className="control"
                                  value={lot.quantity}
                                  onChange={(e) => {
                                    const lots = holding.lots.map((l, x) =>
                                      x === li ? { ...l, quantity: e.target.value } : l,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                />
                              </Field>
                              <Field
                                label={`Price (${holding.currency || "EUR"})`}
                                htmlFor={`lot-price-${i}-${li}`}
                              >
                                <input
                                  id={`lot-price-${i}-${li}`}
                                  inputMode="decimal"
                                  className="control"
                                  value={lot.price}
                                  onChange={(e) => {
                                    const lots = holding.lots.map((l, x) =>
                                      x === li ? { ...l, price: e.target.value } : l,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                />
                              </Field>
                              <Field label="Fees (EUR)" htmlFor={`lot-fees-${i}-${li}`}>
                                <input
                                  id={`lot-fees-${i}-${li}`}
                                  inputMode="decimal"
                                  className="control"
                                  value={lot.fees}
                                  onChange={(e) => {
                                    const lots = holding.lots.map((l, x) =>
                                      x === li ? { ...l, fees: e.target.value } : l,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                />
                              </Field>
                              <Field
                                label="FX → EUR"
                                htmlFor={`lot-fx-${i}-${li}`}
                                help="1 for EUR buys"
                              >
                                <input
                                  id={`lot-fx-${i}-${li}`}
                                  inputMode="decimal"
                                  className="control"
                                  value={lot.fxRate}
                                  onChange={(e) => {
                                    const lots = holding.lots.map((l, x) =>
                                      x === li ? { ...l, fxRate: e.target.value } : l,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                />
                              </Field>
                              <div className="flex items-end pb-1">
                                <button
                                  type="button"
                                  className="button-quiet text-xs"
                                  onClick={() => {
                                    const lots = holding.lots.filter(
                                      (_, x) => x !== li,
                                    );
                                    update(holdings, setHoldings, i, { lots });
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="button-secondary mt-3 text-xs"
                          onClick={() =>
                            update(holdings, setHoldings, i, {
                              lots: [
                                ...holding.lots,
                                {
                                  buyDate: "",
                                  quantity: "",
                                  price: "",
                                  fees: "0",
                                  fxRate: "1",
                                },
                              ],
                            })
                          }
                        >
                          + Add lot
                        </button>
                      </div>
                    </RowCard>
                  ))}
                </div>
                <button
                  type="button"
                  className="button-secondary mt-5"
                  onClick={() =>
                    setHoldings([
                      ...holdings,
                      {
                        accountIndex: 0,
                        isin: "",
                        ticker: "",
                        name: "",
                        currency: "EUR",
                        openingQuantity: "0",
                        acknowledgeUnpriced: false,
                        lots: [],
                      },
                    ])
                  }
                >
                  + Add holding
                </button>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <StepIntro title="Properties & mortgages">
              Each property at its current estimated value (you&apos;ll revalue
              it periodically later). The purchase price feeds capital-gains
              estimates when a sale is ever considered — without it the tax
              shows as unknown, never zero.
            </StepIntro>
            <div className="grid gap-4">
              {properties.map((property, i) => (
                <RowCard
                  key={i}
                  title={`Property ${i + 1}`}
                  onRemove={() => {
                    remove(properties, setProperties, i);
                    setLiabilities(
                      liabilities
                        .filter((l) => l.propertyIndex !== i)
                        .map((l) => ({
                          ...l,
                          propertyIndex:
                            l.propertyIndex != null && l.propertyIndex > i
                              ? l.propertyIndex - 1
                              : l.propertyIndex,
                        })),
                    );
                  }}
                >
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field label="Name" htmlFor={`prop-name-${i}`}>
                      <input
                        id={`prop-name-${i}`}
                        className="control"
                        placeholder="Apartment — city centre"
                        value={property.name}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            name: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Current value (EUR)" htmlFor={`prop-value-${i}`}>
                      <input
                        id={`prop-value-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={property.value}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            value: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Valued on" htmlFor={`prop-valuedat-${i}`}>
                      <input
                        id={`prop-valuedat-${i}`}
                        type="date"
                        className="control"
                        max={today}
                        value={property.valuedAt}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            valuedAt: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Purchase price (EUR)"
                      htmlFor={`prop-pp-${i}`}
                      help="Optional but recommended — feeds capital-gains estimates."
                    >
                      <input
                        id={`prop-pp-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={property.purchasePrice}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            purchasePrice: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Ownership %" htmlFor={`prop-own-${i}`}>
                      <input
                        id={`prop-own-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={property.ownershipPct}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            ownershipPct: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Rent / month (EUR)" htmlFor={`prop-rent-${i}`}>
                      <input
                        id={`prop-rent-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={property.rentMonthly}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            rentMonthly: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Costs / month (EUR)" htmlFor={`prop-costs-${i}`}>
                      <input
                        id={`prop-costs-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={property.costsMonthly}
                        onChange={(e) =>
                          update(properties, setProperties, i, {
                            costsMonthly: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={property.isPrimaryResidence}
                      onChange={(e) =>
                        update(properties, setProperties, i, {
                          isPrimaryResidence: e.target.checked,
                        })
                      }
                    />
                    Primary residence (vivienda habitual — wealth-tax exemption
                    and CG treatment)
                  </label>
                </RowCard>
              ))}
            </div>
            <button
              type="button"
              className="button-secondary mt-5"
              onClick={() =>
                setProperties([
                  ...properties,
                  {
                    name: "",
                    value: "",
                    purchasePrice: "",
                    ownershipPct: "100",
                    rentMonthly: "0",
                    costsMonthly: "0",
                    isPrimaryResidence: false,
                    valuedAt: today,
                  },
                ])
              }
            >
              + Add property
            </button>

            {properties.length > 0 && (
              <div className="mt-8 border-t border-[var(--hairline)] pt-6">
                <div className="eyebrow mb-4">Mortgages</div>
                <div className="grid gap-4">
                  {liabilities.map((liability, i) => (
                    <RowCard
                      key={i}
                      title={`Mortgage ${i + 1}`}
                      onRemove={() => remove(liabilities, setLiabilities, i)}
                    >
                      <div className="grid gap-5 sm:grid-cols-4">
                        <Field label="Property" htmlFor={`liab-prop-${i}`}>
                          <select
                            id={`liab-prop-${i}`}
                            className="control"
                            value={liability.propertyIndex ?? ""}
                            onChange={(e) =>
                              update(liabilities, setLiabilities, i, {
                                propertyIndex:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          >
                            {properties.map((property, pi) => (
                              <option key={pi} value={pi}>
                                {property.name || `Property ${pi + 1}`}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Balance (EUR)" htmlFor={`liab-bal-${i}`}>
                          <input
                            id={`liab-bal-${i}`}
                            inputMode="decimal"
                            className="control"
                            value={liability.balance}
                            onChange={(e) =>
                              update(liabilities, setLiabilities, i, {
                                balance: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field
                          label="Rate"
                          htmlFor={`liab-rate-${i}`}
                          help="e.g. 0.021 for 2.1%"
                        >
                          <input
                            id={`liab-rate-${i}`}
                            inputMode="decimal"
                            className="control"
                            value={liability.rate}
                            onChange={(e) =>
                              update(liabilities, setLiabilities, i, {
                                rate: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field
                          label="Payment / month (EUR)"
                          htmlFor={`liab-pay-${i}`}
                        >
                          <input
                            id={`liab-pay-${i}`}
                            inputMode="decimal"
                            className="control"
                            value={liability.payment}
                            onChange={(e) =>
                              update(liabilities, setLiabilities, i, {
                                payment: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    </RowCard>
                  ))}
                </div>
                <button
                  type="button"
                  className="button-secondary mt-4"
                  onClick={() =>
                    setLiabilities([
                      ...liabilities,
                      { propertyIndex: 0, rate: "", balance: "", payment: "" },
                    ])
                  }
                >
                  + Add mortgage
                </button>
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <StepIntro title="Assumptions">
              The coarse planning figures the calculators run on. Monthly spend
              and the safe withdrawal rate are required — without them the
              first snapshot is born Data stale. Big round figures; you review
              them yearly, not monthly.
            </StepIntro>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Monthly spend (EUR) — required"
                htmlFor="as-spend"
                help="A coarse figure for everything you spend in a typical month."
              >
                <input
                  id="as-spend"
                  inputMode="decimal"
                  className="control"
                  value={assumption.monthlySpend}
                  onChange={(e) =>
                    setAssumption({ ...assumption, monthlySpend: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Safe withdrawal rate — required"
                htmlFor="as-swr"
                help="0.035 = 3.5%, the usual rule-of-thumb band is 0.03–0.04."
              >
                <input
                  id="as-swr"
                  inputMode="decimal"
                  className="control"
                  value={assumption.safeWithdrawalRate}
                  onChange={(e) =>
                    setAssumption({
                      ...assumption,
                      safeWithdrawalRate: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Conservative monthly spend"
                htmlFor="as-spend-cons"
                help="Optional — produces its own runway."
              >
                <input
                  id="as-spend-cons"
                  inputMode="decimal"
                  className="control"
                  value={assumption.monthlySpendConservative}
                  onChange={(e) =>
                    setAssumption({
                      ...assumption,
                      monthlySpendConservative: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Optimistic monthly spend"
                htmlFor="as-spend-opt"
                help="Optional."
              >
                <input
                  id="as-spend-opt"
                  inputMode="decimal"
                  className="control"
                  value={assumption.monthlySpendOptimistic}
                  onChange={(e) =>
                    setAssumption({
                      ...assumption,
                      monthlySpendOptimistic: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Expected return (nominal)"
                htmlFor="as-return"
                help="Your long-run nominal portfolio return guess, e.g. 0.07."
              >
                <input
                  id="as-return"
                  inputMode="decimal"
                  className="control"
                  value={assumption.expectedReturn}
                  onChange={(e) =>
                    setAssumption({
                      ...assumption,
                      expectedReturn: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Long-run inflation"
                htmlFor="as-inflation"
                help="Your forecast, e.g. 0.02 — the observed rate updates separately from the ECB feed."
              >
                <input
                  id="as-inflation"
                  inputMode="decimal"
                  className="control"
                  value={assumption.longRunInflation}
                  onChange={(e) =>
                    setAssumption({
                      ...assumption,
                      longRunInflation: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Birth date"
                htmlFor="as-birth"
                help="Optional — lets the Ask layer reason about your age. Never sent raw anywhere else."
              >
                <input
                  id="as-birth"
                  type="date"
                  className="control"
                  max={today}
                  value={assumption.birthDate}
                  onChange={(e) =>
                    setAssumption({ ...assumption, birthDate: e.target.value })
                  }
                />
              </Field>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <StepIntro title="Planned events">
              Forecasts, not facts — a possible inheritance, a future house
              purchase, leaving the job. They never move today&apos;s net
              worth; scenarios consume them. Optional, skip freely.
            </StepIntro>
            <div className="grid gap-4">
              {events.map((event, i) => (
                <RowCard
                  key={i}
                  title={`Event ${i + 1}`}
                  onRemove={() => remove(events, setEvents, i)}
                >
                  <div className="grid gap-5 sm:grid-cols-4">
                    <Field label="Type" htmlFor={`ev-type-${i}`}>
                      <select
                        id={`ev-type-${i}`}
                        className="control"
                        value={event.type}
                        onChange={(e) =>
                          update(events, setEvents, i, {
                            type: e.target.value as EventDraft["type"],
                          })
                        }
                      >
                        {PLANNED_EVENT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {EVENT_LABEL[type]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Expected date" htmlFor={`ev-date-${i}`}>
                      <input
                        id={`ev-date-${i}`}
                        type="date"
                        className="control"
                        value={event.date}
                        onChange={(e) =>
                          update(events, setEvents, i, { date: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Amount (EUR)" htmlFor={`ev-amount-${i}`}>
                      <input
                        id={`ev-amount-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={event.amount}
                        onChange={(e) =>
                          update(events, setEvents, i, {
                            amount: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Probability"
                      htmlFor={`ev-prob-${i}`}
                      help="0–1"
                    >
                      <input
                        id={`ev-prob-${i}`}
                        inputMode="decimal"
                        className="control"
                        value={event.probability}
                        onChange={(e) =>
                          update(events, setEvents, i, {
                            probability: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={event.includedInBaseCase}
                      onChange={(e) =>
                        update(events, setEvents, i, {
                          includedInBaseCase: e.target.checked,
                        })
                      }
                    />
                    Include in the base case (certain enough to plan on)
                  </label>
                </RowCard>
              ))}
            </div>
            <button
              type="button"
              className="button-secondary mt-5"
              onClick={() =>
                setEvents([
                  ...events,
                  {
                    type: "inheritance",
                    date: today,
                    amount: "",
                    probability: "1",
                    includedInBaseCase: false,
                    note: "",
                  },
                ])
              }
            >
              + Add event
            </button>
          </>
        )}

        {step === 6 && review && (
          <>
            <StepIntro title="Review & commit">
              One transaction writes everything below and computes your first
              snapshot. Nothing has been saved yet — going back is free.
            </StepIntro>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="fine-print">Baseline</dt>
                <dd className="mt-1 tabular-nums">{baselineAsOf}</dd>
              </div>
              <div>
                <dt className="fine-print">Accounts</dt>
                <dd className="mt-1">{accounts.length}</dd>
              </div>
              <div>
                <dt className="fine-print">Holdings / lots</dt>
                <dd className="mt-1">
                  {holdings.length} /{" "}
                  {holdings.reduce((n, h) => n + h.lots.length, 0)}
                </dd>
              </div>
              <div>
                <dt className="fine-print">Properties / mortgages</dt>
                <dd className="mt-1">
                  {properties.length} / {liabilities.length}
                </dd>
              </div>
              <div>
                <dt className="fine-print">Assumptions</dt>
                <dd className="mt-1">{review.input.assumptions.length}</dd>
              </div>
              <div>
                <dt className="fine-print">Planned events</dt>
                <dd className="mt-1">{events.length}</dd>
              </div>
            </dl>

            {review.errors.length > 0 && (
              <div className="notice notice-red mt-6 text-sm leading-6">
                <p className="font-medium">Fix before committing:</p>
                <ul className="mt-2 list-disc pl-5">
                  {review.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.warnings.length > 0 && (
              <div className="notice notice-amber mt-6 text-sm leading-6">
                <p className="font-medium">Worth a look (won&apos;t block):</p>
                <ul className="mt-2 list-disc pl-5">
                  {review.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {serverError && (
              <div className="notice notice-red mt-6 text-sm leading-6">
                {serverError}
              </div>
            )}
          </>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-[var(--hairline)] pt-6">
          <button
            type="button"
            className="button-secondary"
            disabled={step === 0 || submitting}
            onClick={() => setStep(step - 1)}
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="button-primary"
              onClick={() => setStep(step + 1)}
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={submitting || (review?.errors.length ?? 1) > 0}
              onClick={commit}
            >
              {submitting ? "Committing…" : "Commit baseline"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
