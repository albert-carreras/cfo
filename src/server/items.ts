import { eq } from "drizzle-orm";
import { z } from "zod";
import { dec, formatEURWhole, formatUnits } from "@/calc/money";
import {
  accounts,
  holdings,
  liabilities,
  otherAssets,
  plannedEvents,
  properties,
  taxLots,
} from "./db/schema";
import { setAssumption } from "./assumptions";
import { liveAccount, liveHolding } from "./ledger";
import {
  finishChange,
  intentTransaction,
  RecordError,
  utcDate,
  type ActivityLine,
} from "./write";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  ASSUMPTION_RANGES,
  OTHER_ASSET_CATEGORIES,
  optionalText,
  percentString,
  PLANNING_INPUTS,
} from "@/shared/inputs";
import { PLAN_TYPES, planLabel, isAmountTBD, isTimingUnknown } from "@/shared/plans";
import { decimalString, isoDate, nonNegativeDecimalString } from "@/shared/validation";

// Adding, editing and closing the things you own, plus plans and planning
// inputs. Each is one transaction, one recompute and one activity entry.

const euro = formatEURWhole;

function notFuture(date: string, now: Date) {
  if (date > utcDate(now)) throw new RecordError("The date can't be in the future.");
}

// --- Accounts ---------------------------------------------------------------

export const addAccountSchema = z.object({
  name: z.string().trim().min(1, "Give it a name."),
  type: z.enum(ACCOUNT_TYPES),
  balance: nonNegativeDecimalString,
  asOf: isoDate,
});

export async function addAccount(input: unknown, now = new Date()) {
  const value = addAccountSchema.parse(input);
  notFuture(value.asOf, now);
  return intentTransaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        name: value.name,
        type: value.type,
        currency: "EUR",
        openingCash: dec(value.balance).toFixed(2),
        openingAsOf: value.asOf,
      })
      .returning();
    await finishChange(tx, now, {
      asOf: value.asOf,
      kind: "add",
      title: `Added ${row.name}`,
      lines: [
        { label: "Type", value: ACCOUNT_TYPE_LABELS[row.type] },
        { label: "Balance", value: euro(row.openingCash) },
      ],
    });
    return row;
  });
}

export async function editAccount(input: unknown, now = new Date()) {
  const value = z
    .object({ id: z.string().min(1), name: z.string().trim().min(1), type: z.enum(ACCOUNT_TYPES) })
    .parse(input);
  return intentTransaction(async (tx) => {
    const row = await liveAccount(tx, value.id);
    await tx.update(accounts).set({ name: value.name, type: value.type }).where(eq(accounts.id, row.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Edited ${value.name}`,
      lines: changedLines([
        ["Name", row.name, value.name],
        ["Type", ACCOUNT_TYPE_LABELS[row.type], ACCOUNT_TYPE_LABELS[value.type]],
      ]),
    });
  });
}

function changedLines(pairs: [string, string | null, string | null][]): ActivityLine[] {
  return pairs
    .filter(([, before, after]) => (before ?? "") !== (after ?? ""))
    .map(([label, before, after]) => ({ label, value: `${before ?? "—"} → ${after ?? "—"}` }));
}

// --- Investments ------------------------------------------------------------

export const addHoldingSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().trim().min(1, "Give it a name."),
  ticker: z.string().trim().min(1, "A ticker is needed for the daily price.").transform((v) => v.toUpperCase()),
  units: nonNegativeDecimalString,
  // What the units you hold cost in total: the FIFO basis for later sales.
  costEUR: nonNegativeDecimalString.nullish(),
  asOf: isoDate,
});

export async function addHolding(input: unknown, now = new Date()) {
  const value = addHoldingSchema.parse(input);
  notFuture(value.asOf, now);
  return intentTransaction(async (tx) => {
    const account = await liveAccount(tx, value.accountId);
    if (account.type === "manual") {
      throw new RecordError("Investments live in a broker, bank or pension account.");
    }
    const [row] = await tx
      .insert(holdings)
      .values({
        accountId: account.id,
        // Prices are keyed by this; the ticker is the natural key.
        isin: value.ticker,
        ticker: value.ticker,
        name: value.name,
        openingQuantity: dec(value.units).toString(),
        openingAsOf: value.asOf,
      })
      .returning();
    const lines: ActivityLine[] = [
      { label: "In", value: account.name },
      { label: "Units", value: formatUnits(value.units) },
    ];
    if (value.costEUR && dec(value.units).greaterThan(0)) {
      await tx.insert(taxLots).values({
        holdingId: row.id,
        buyDate: value.asOf,
        quantity: dec(value.units).toString(),
        price: dec(value.costEUR).dividedBy(value.units).toString(),
        fees: "0",
        fxRate: "1",
        costBasisEUR: dec(value.costEUR).toFixed(2),
      });
      lines.push({ label: "Cost basis", value: euro(value.costEUR) });
    }
    await finishChange(tx, now, {
      asOf: value.asOf,
      kind: "add",
      title: `Added ${value.ticker}`,
      lines,
    });
    return row;
  });
}

export async function editHolding(input: unknown, now = new Date()) {
  const value = z
    .object({
      id: z.string().min(1),
      name: z.string().trim().min(1),
      ticker: z.string().trim().min(1).transform((v) => v.toUpperCase()),
    })
    .parse(input);
  return intentTransaction(async (tx) => {
    const row = await liveHolding(tx, value.id);
    const [updated] = await tx
      .update(holdings)
      .set({ name: value.name, ticker: value.ticker })
      .where(eq(holdings.id, row.id))
      .returning();
    await finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Edited ${value.ticker}`,
      lines: changedLines([
        ["Name", row.name, value.name],
        ["Ticker", row.ticker, value.ticker],
      ]),
    });
    return updated;
  });
}

export const addLotSchema = z.object({
  holdingId: z.string().min(1),
  buyDate: isoDate,
  units: decimalString,
  costEUR: nonNegativeDecimalString,
});

// A purchase you already held: cost basis only, units are unchanged.
export async function addLot(input: unknown, now = new Date()) {
  const value = addLotSchema.parse(input);
  notFuture(value.buyDate, now);
  return intentTransaction(async (tx) => {
    const holding = await liveHolding(tx, value.holdingId);
    await tx.insert(taxLots).values({
      holdingId: holding.id,
      buyDate: value.buyDate,
      quantity: dec(value.units).toString(),
      price: dec(value.costEUR).dividedBy(value.units).toString(),
      fees: "0",
      fxRate: "1",
      costBasisEUR: dec(value.costEUR).toFixed(2),
    });
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Added a ${holding.ticker ?? holding.name} purchase lot`,
      lines: [{ label: value.buyDate, value: `${formatUnits(value.units)} for ${euro(value.costEUR)}` }],
    });
  });
}

// --- Property ---------------------------------------------------------------

const propertyFields = {
  name: z.string().trim().min(1, "Give it a name."),
  ownershipPct: percentString,
  purchasePrice: nonNegativeDecimalString.nullish(),
  rentMonthly: nonNegativeDecimalString.default("0"),
  costsMonthly: nonNegativeDecimalString.default("0"),
  isPrimaryResidence: z.boolean().default(false),
};

export const addPropertySchema = z.object({
  ...propertyFields,
  value: decimalString,
  valuedAt: isoDate,
  mortgageBalance: decimalString.nullish(),
  mortgageRate: nonNegativeDecimalString.nullish(),
  mortgagePayment: nonNegativeDecimalString.nullish(),
});

export async function addProperty(input: unknown, now = new Date()) {
  const value = addPropertySchema.parse(input);
  notFuture(value.valuedAt, now);
  return intentTransaction(async (tx) => {
    const [row] = await tx
      .insert(properties)
      .values({
        name: value.name,
        value: dec(value.value).toFixed(2),
        purchasePrice: value.purchasePrice ?? null,
        ownershipPct: value.ownershipPct,
        rentMonthly: value.rentMonthly,
        costsMonthly: value.costsMonthly,
        isPrimaryResidence: value.isPrimaryResidence,
        valuedAt: value.valuedAt,
      })
      .returning();
    const lines: ActivityLine[] = [
      { label: "Value", value: `${euro(value.value)} (${value.ownershipPct}% yours)` },
    ];
    if (value.mortgageBalance) {
      await tx.insert(liabilities).values({
        type: "mortgage",
        name: `Mortgage · ${value.name}`,
        propertyId: row.id,
        balance: dec(value.mortgageBalance).toFixed(2),
        rate: value.mortgageRate ?? null,
        payment: value.mortgagePayment ?? null,
      });
      lines.push({ label: "Mortgage", value: euro(value.mortgageBalance) });
    }
    await finishChange(tx, now, { asOf: value.valuedAt, kind: "add", title: `Added ${value.name}`, lines });
    return row;
  });
}

export async function editProperty(input: unknown, now = new Date()) {
  const value = z.object({ id: z.string().min(1), ...propertyFields }).parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(properties).where(eq(properties.id, value.id)).limit(1);
    if (!row || row.disposedAt) throw new RecordError("That property doesn't exist or is closed.");
    await tx
      .update(properties)
      .set({
        name: value.name,
        ownershipPct: value.ownershipPct,
        purchasePrice: value.purchasePrice ?? null,
        rentMonthly: value.rentMonthly,
        costsMonthly: value.costsMonthly,
        isPrimaryResidence: value.isPrimaryResidence,
      })
      .where(eq(properties.id, row.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Edited ${value.name}`,
      lines: changedLines([
        ["Name", row.name, value.name],
        ["Ownership", `${dec(row.ownershipPct)}%`, `${dec(value.ownershipPct)}%`],
        ["Purchase price", row.purchasePrice ? euro(row.purchasePrice) : null, value.purchasePrice ? euro(value.purchasePrice) : null],
        ["Rent / month", euro(row.rentMonthly), euro(value.rentMonthly)],
        ["Costs / month", euro(row.costsMonthly), euro(value.costsMonthly)],
        ["Your home", row.isPrimaryResidence ? "yes" : "no", value.isPrimaryResidence ? "yes" : "no"],
      ]),
    });
  });
}

// --- Debt -------------------------------------------------------------------

export const addLiabilitySchema = z.object({
  name: z.string().trim().min(1, "Give it a name."),
  balance: decimalString,
  rate: nonNegativeDecimalString.nullish(),
  payment: nonNegativeDecimalString.nullish(),
  propertyId: z.string().min(1).nullish(),
});

export async function addLiability(input: unknown, now = new Date()) {
  const value = addLiabilitySchema.parse(input);
  return intentTransaction(async (tx) => {
    if (value.propertyId) {
      const [property] = await tx.select().from(properties).where(eq(properties.id, value.propertyId)).limit(1);
      if (!property || property.disposedAt) throw new RecordError("That property doesn't exist.");
    }
    const [row] = await tx
      .insert(liabilities)
      .values({
        type: value.propertyId ? "mortgage" : "loan",
        name: value.name,
        propertyId: value.propertyId ?? null,
        balance: dec(value.balance).toFixed(2),
        rate: value.rate ?? null,
        payment: value.payment ?? null,
      })
      .returning();
    await finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "add",
      title: `Added ${value.name}`,
      lines: [{ label: "Balance", value: euro(value.balance) }],
    });
    return row;
  });
}

export async function editLiability(input: unknown, now = new Date()) {
  const value = z
    .object({
      id: z.string().min(1),
      name: z.string().trim().min(1),
      rate: nonNegativeDecimalString.nullish(),
      payment: nonNegativeDecimalString.nullish(),
    })
    .parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(liabilities).where(eq(liabilities.id, value.id)).limit(1);
    if (!row || row.disposedAt) throw new RecordError("That debt doesn't exist or is closed.");
    await tx
      .update(liabilities)
      .set({ name: value.name, rate: value.rate ?? null, payment: value.payment ?? null })
      .where(eq(liabilities.id, row.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Edited ${value.name}`,
      lines: changedLines([
        ["Name", row.name, value.name],
        ["Rate", row.rate, value.rate ?? null],
        ["Payment", row.payment, value.payment ?? null],
      ]),
    });
  });
}

// --- Other assets -----------------------------------------------------------

export const addOtherAssetSchema = z.object({
  name: z.string().trim().min(1, "Give it a name."),
  category: z.enum(OTHER_ASSET_CATEGORIES),
  value: nonNegativeDecimalString,
  includeInNetWorth: z.boolean().default(false),
  valuedAt: isoDate,
  note: optionalText,
});

export async function addOtherAsset(input: unknown, now = new Date()) {
  const value = addOtherAssetSchema.parse(input);
  notFuture(value.valuedAt, now);
  return intentTransaction(async (tx) => {
    const [row] = await tx
      .insert(otherAssets)
      .values({ ...value, value: dec(value.value).toFixed(2), note: value.note ?? null })
      .returning();
    await finishChange(tx, now, {
      asOf: value.valuedAt,
      kind: "add",
      title: `Added ${value.name}`,
      lines: [
        { label: "Value", value: euro(value.value) },
        { label: "In net worth", value: value.includeInNetWorth ? "yes" : "no" },
      ],
    });
    return row;
  });
}

export async function editOtherAsset(input: unknown, now = new Date()) {
  const value = z
    .object({
      id: z.string().min(1),
      name: z.string().trim().min(1),
      category: z.enum(OTHER_ASSET_CATEGORIES),
      includeInNetWorth: z.boolean().default(false),
      note: optionalText,
    })
    .parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(otherAssets).where(eq(otherAssets.id, value.id)).limit(1);
    if (!row || row.disposedAt) throw new RecordError("That asset doesn't exist or is closed.");
    await tx
      .update(otherAssets)
      .set({ name: value.name, category: value.category, includeInNetWorth: value.includeInNetWorth, note: value.note ?? null })
      .where(eq(otherAssets.id, row.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "edit",
      title: `Edited ${value.name}`,
      lines: changedLines([
        ["Name", row.name, value.name],
        ["In net worth", row.includeInNetWorth ? "yes" : "no", value.includeInNetWorth ? "yes" : "no"],
      ]),
    });
  });
}

// --- Plans ------------------------------------------------------------------

export const planSchema = z.object({
  type: z.enum(PLAN_TYPES),
  date: isoDate,
  amount: nonNegativeDecimalString,
  note: optionalText,
});

function planSummary(plan: { type: string; date: string; amount: string }) {
  return `${isTimingUnknown(plan.date) ? "timing unknown" : plan.date} · ${isAmountTBD(plan.amount) ? "amount TBD" : euro(plan.amount)}`;
}

export async function savePlan(input: unknown, now = new Date()) {
  const value = planSchema.extend({ id: z.string().min(1).nullish() }).parse(input);
  return intentTransaction(async (tx) => {
    const fields = {
      type: value.type,
      date: value.date,
      amount: dec(value.amount).toFixed(2),
      note: value.note ?? null,
    };
    if (value.id) {
      const [row] = await tx.select().from(plannedEvents).where(eq(plannedEvents.id, value.id)).limit(1);
      if (!row || row.realisedAt) throw new RecordError("That plan doesn't exist or is done.");
      await tx.update(plannedEvents).set(fields).where(eq(plannedEvents.id, row.id));
    } else {
      await tx.insert(plannedEvents).values(fields);
    }
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "plan",
      title: `${value.id ? "Updated" : "Added"} plan: ${planLabel(value.type)}`,
      lines: [{ label: "When / how much", value: planSummary(fields) }],
      note: value.note,
    });
  });
}

export async function completePlan(input: unknown, now = new Date()) {
  const value = z.object({ id: z.string().min(1) }).parse(input);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(plannedEvents).where(eq(plannedEvents.id, value.id)).limit(1);
    if (!row || row.realisedAt) throw new RecordError("That plan doesn't exist or is already done.");
    await tx.update(plannedEvents).set({ realisedAt: now }).where(eq(plannedEvents.id, row.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "plan",
      title: `Closed plan: ${planLabel(row.type)}`,
    });
  });
}

// --- Planning inputs --------------------------------------------------------

export async function savePlanningInputs(
  input: { key: string; value: string }[],
  now = new Date(),
) {
  const known = new Map<string, (typeof PLANNING_INPUTS)[number]>(
    PLANNING_INPUTS.map((row) => [row.key, row]),
  );
  for (const row of input) {
    const def = known.get(row.key);
    if (!def) throw new RecordError(`"${row.key}" can't be edited here.`);
    if (def.kind === "date") {
      isoDate.parse(row.value);
      continue;
    }
    const parsed = z.string().regex(/^\d+(\.\d+)?$/, `${def.label} must be a number.`).parse(row.value);
    const range = ASSUMPTION_RANGES[row.key];
    if (range && (dec(parsed).lessThanOrEqualTo(range.min) || dec(parsed).greaterThan(range.max))) {
      throw new RecordError(
        row.key === "safeWithdrawalRate"
          ? "Write the withdrawal rate as a fraction: 0.035 for 3.5%."
          : `${def.label} looks wrong.`,
      );
    }
  }
  if (input.length === 0) return null;
  return intentTransaction(async (tx) => {
    for (const row of input) {
      const date = known.get(row.key)?.kind === "date";
      await setAssumption(
        {
          key: row.key,
          value: date ? null : row.value,
          dateValue: date ? row.value : null,
          source: "user",
        },
        { database: tx, now },
      );
    }
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "inputs",
      title: input.length === 1 ? `Updated ${known.get(input[0].key)?.label}` : "Updated planning inputs",
      lines: input.map((row) => ({ label: known.get(row.key)?.label ?? row.key, value: row.value })),
    });
  });
}
