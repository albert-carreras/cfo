import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { dec, formatEURWhole, formatUnits, type Money } from "@/calc/money";
import { fifoCostBasis, savingsTax } from "@/calc/tax";
import {
  accounts,
  holdings,
  liabilities,
  otherAssets,
  properties,
  revaluations,
  sales,
  taxLots,
  taxSettlements,
} from "./db/schema";
import { loadFacts } from "./facts";
import {
  appendMovementTx,
  appendObservationTx,
  appendTransferTx,
  currentState,
  liveAccount,
  liveHolding,
  type ObservationType,
} from "./ledger";
import {
  finishChange,
  intentTransaction,
  RecordError,
  utcDate,
  type ActivityLine,
  type DbTransaction,
} from "./write";
import { optionalText } from "@/shared/inputs";
import {
  decimalString,
  isoDate,
  nonNegativeDecimalString,
} from "@/shared/validation";

// The things that happen: values confirmed, an investment sold or bought,
// money moved, tax paid. Each is ONE transaction that does every write the
// event implies, then recomputes and logs one activity entry.

const euro = formatEURWhole;

function holdingLabel(row: { ticker: string | null; name: string }) {
  return row.ticker ?? row.name;
}

// Where the cash side of an event goes: the investment's own account, another
// account, or nowhere (you already updated that balance yourself).
const cashTarget = z.union([z.literal("same"), z.literal("none"), z.string().min(1)]);

// --- Confirm values ---------------------------------------------------------

export const setValuesSchema = z.object({
  asOf: isoDate,
  note: optionalText,
  values: z
    .array(
      z.object({
        assetType: z.enum(["account", "holding", "property", "liability", "other_asset"]),
        assetId: z.string().min(1),
        value: nonNegativeDecimalString,
      }),
    )
    .min(1, "Enter at least one value."),
});

export async function setValues(input: unknown, now = new Date()) {
  const value = setValuesSchema.parse(input);
  if (value.asOf > utcDate(now)) throw new RecordError("The date can't be in the future.");
  if (new Set(value.values.map((row) => `${row.assetType}:${row.assetId}`)).size !== value.values.length) {
    throw new RecordError("Each item may appear only once.");
  }
  return intentTransaction(async (tx) => {
    const { facts, rows } = await loadFacts(tx, value.asOf);
    const state = await currentState(tx, value.asOf);
    const lines: ActivityLine[] = [];
    for (const item of value.values) {
      const { name, before, opening, format } = describeValue(item.assetType, item.assetId, {
        facts,
        rows,
        state,
      });
      if (opening && value.asOf < opening) {
        throw new RecordError(
          `${name} was added on ${opening}; a value dated before that can't apply.`,
        );
      }
      await appendObservationTx(
        tx,
        {
          assetType: item.assetType,
          assetId: item.assetId,
          value: item.value,
          valuedAt: value.asOf,
          note: value.note,
        },
        now,
      );
      lines.push({
        label: name,
        value: dec(before).equals(item.value)
          ? `${format(item.value)} (confirmed)`
          : `${format(before)} → ${format(item.value)}`,
      });
    }
    return finishChange(tx, now, {
      asOf: value.asOf,
      kind: "values",
      title:
        lines.length === 1 ? `Updated ${lines[0].label}` : `Updated ${lines.length} values`,
      lines,
      note: value.note,
    });
  });
}

function describeValue(
  assetType: ObservationType,
  assetId: string,
  ctx: {
    facts: Awaited<ReturnType<typeof loadFacts>>["facts"];
    rows: Awaited<ReturnType<typeof loadFacts>>["rows"];
    state: Awaited<ReturnType<typeof currentState>>;
  },
): { name: string; before: Money; opening: string | null; format: (v: Money) => string } {
  const missing = () => new RecordError("One of those items doesn't exist or is closed.");
  if (assetType === "account") {
    const row = ctx.rows.accounts.find((a) => a.id === assetId && !a.disposedAt);
    if (!row) throw missing();
    return {
      name: row.name,
      before: ctx.state.cashByAccount[row.id] ?? row.openingCash,
      opening: row.openingAsOf,
      format: euro,
    };
  }
  if (assetType === "holding") {
    const row = ctx.rows.holdings.find((h) => h.id === assetId && !h.disposedAt);
    if (!row) throw missing();
    return {
      name: `${holdingLabel(row)} units`,
      before: ctx.state.quantityByHolding[row.id] ?? row.openingQuantity,
      opening: row.openingAsOf,
      format: formatUnits,
    };
  }
  if (assetType === "property") {
    const row = ctx.facts.properties.find((p) => p.id === assetId);
    if (!row) throw missing();
    return { name: row.name ?? "Property", before: row.value, opening: null, format: euro };
  }
  if (assetType === "liability") {
    const row = ctx.facts.liabilities.find((l) => l.id === assetId);
    if (!row) throw missing();
    return { name: row.name ?? "Debt", before: row.balance, opening: null, format: euro };
  }
  const row = ctx.facts.otherAssets?.find((o) => o.id === assetId);
  if (!row) throw missing();
  return { name: row.name ?? "Asset", before: row.value, opening: null, format: euro };
}

// Units of a holding on a date, and the date they were last confirmed.
async function unitsOn(tx: DbTransaction, holdingId: string, date: string, today: string) {
  const state = await currentState(tx, date);
  const observed = await tx
    .select({ valuedAt: revaluations.valuedAt })
    .from(revaluations)
    .where(and(eq(revaluations.assetType, "holding"), eq(revaluations.assetId, holdingId)));
  const lastConfirmed = observed
    .map((row) => row.valuedAt)
    .filter((d) => d <= today)
    .sort()
    .at(-1);
  return { units: dec(state.quantityByHolding[holdingId] ?? 0), lastConfirmed: lastConfirmed ?? null };
}

// --- Sold an investment -----------------------------------------------------

export const sellSchema = z.object({
  holdingId: z.string().min(1),
  units: decimalString.nullish(), // blank = all of it
  proceedsEUR: nonNegativeDecimalString,
  date: isoDate,
  to: cashTarget,
  costBasisEUR: nonNegativeDecimalString.nullish(),
  note: optionalText,
});

export async function sellInvestment(input: unknown, now = new Date()) {
  const value = sellSchema.parse(input);
  if (value.date > utcDate(now)) throw new RecordError("The sale date can't be in the future.");
  return intentTransaction(async (tx) => {
    const holding = await liveHolding(tx, value.holdingId);
    const account = await liveAccount(tx, holding.accountId);
    const label = holdingLabel(holding);
    if (value.date < holding.openingAsOf) {
      throw new RecordError(
        `${label} was added on ${holding.openingAsOf} with the units you held then, so an earlier sale is already included.`,
      );
    }
    const { units: held, lastConfirmed } = await unitsOn(tx, holding.id, value.date, utcDate(now));
    if (lastConfirmed && value.date < lastConfirmed) {
      throw new RecordError(
        `${label} units were last confirmed on ${lastConfirmed}, so a sale before that would be ignored. If you sold earlier, use ${lastConfirmed} as the date: the tax year is what matters.`,
      );
    }
    const units = value.units ? dec(value.units) : held;
    if (!units.greaterThan(0)) throw new RecordError(`You hold no ${label} on that date.`);
    if (units.greaterThan(held)) {
      throw new RecordError(`You held ${formatUnits(held)} ${label} on that date, not ${formatUnits(units)}.`);
    }

    // FIFO over the purchase lots, after the units earlier sales used up.
    const [lots, previous] = await Promise.all([
      tx.select().from(taxLots).where(eq(taxLots.holdingId, holding.id)),
      tx
        .select()
        .from(sales)
        .where(and(eq(sales.holdingId, holding.id), isNull(sales.voidedAt))),
    ]);
    const fifo = fifoCostBasis({
      lots,
      alreadySold: previous.reduce((acc, row) => acc.plus(row.quantity), dec(0)).toString(),
      quantity: units.toString(),
    });
    const costBasis = value.costBasisEUR ?? fifo;
    await tx.insert(sales).values({
      holdingId: holding.id,
      soldAt: value.date,
      quantity: units.toString(),
      proceedsEUR: dec(value.proceedsEUR).toFixed(2),
      costBasisEUR: costBasis,
      costBasisSource: value.costBasisEUR ? "manual" : "fifo",
      note: value.note,
    });

    const lines: ActivityLine[] = [];
    const proceeds = dec(value.proceedsEUR);
    const target =
      value.to === "none" ? null : value.to === "same" ? account : await liveAccount(tx, value.to);
    // An account added after the sale date was entered with a balance that
    // already contains the money: nothing to move.
    const alreadyIncluded = target !== null && target.openingAsOf > value.date;
    if (target === null || alreadyIncluded || !proceeds.greaterThan(0)) {
      await appendObservationTx(
        tx,
        {
          assetType: "holding",
          assetId: holding.id,
          value: held.minus(units).toString(),
          valuedAt: value.date,
          note: `Sold ${formatUnits(units)}`,
        },
        now,
      );
      lines.push({
        label: "Cash",
        value: alreadyIncluded
          ? `no balance changed: ${target.name} was added after the sale, so its balance already includes it`
          : "no balance changed",
      });
    } else {
      await appendMovementTx(
        tx,
        {
          type: "sell",
          accountId: account.id,
          holdingId: holding.id,
          quantity: units.toString(),
          amount: proceeds.toFixed(2),
          occurredAt: value.date,
          note: value.note,
        },
        now,
      );
      if (target.id !== account.id) {
        await appendTransferTx(
          tx,
          {
            fromAccountId: account.id,
            toAccountId: target.id,
            amount: proceeds.toFixed(2),
            occurredAt: value.date,
            note: `Proceeds from ${label}`,
          },
          now,
        );
      }
      lines.push({ label: "Money to", value: `${target.name} (+${euro(proceeds)})` });
    }

    if (costBasis !== null) {
      const gain = proceeds.minus(costBasis);
      lines.push({ label: "Cost basis", value: `${euro(costBasis)}${value.costBasisEUR ? " (entered)" : " (FIFO)"}` });
      lines.push({ label: gain.isNegative() ? "Loss" : "Gain", value: euro(gain.abs()) });
      // The year's gains are taxed together, so the useful figure is the
      // year's running estimate, not this sale on its own.
      const year = value.date.slice(0, 4);
      const yearSales = await tx.select().from(sales).where(isNull(sales.voidedAt));
      const yearGain = yearSales
        .filter((row) => row.soldAt.startsWith(year) && row.costBasisEUR !== null)
        .reduce((acc, row) => acc.plus(row.proceedsEUR).minus(row.costBasisEUR as string), dec(0));
      lines.push({ label: `${year} tax estimate now`, value: `about ${euro(savingsTax(yearGain.toFixed(2)))}` });
    } else {
      lines.push({ label: "Cost basis", value: "unknown; add it under Taxes" });
    }

    // Fully sold: the position leaves the live record (its lots and sales stay).
    const today = await currentState(tx, utcDate(now));
    if (dec(today.quantityByHolding[holding.id] ?? 0).isZero()) {
      await tx.update(holdings).set({ disposedAt: now }).where(eq(holdings.id, holding.id));
      lines.push({ label: label, value: "fully sold, closed" });
    }

    return finishChange(tx, now, {
      asOf: value.date,
      kind: "sell",
      title: `Sold ${formatUnits(units)} ${label} for ${euro(proceeds)}`,
      lines,
      note: value.note,
    });
  });
}

// --- Bought an investment ---------------------------------------------------

export const buySchema = z.object({
  // An existing investment, or "new" with the fields below.
  holdingId: z.string().min(1),
  newHolding: z
    .object({
      accountId: z.string().min(1, "Pick the account it's in."),
      name: z.string().trim().min(1, "Give the new investment a name."),
      ticker: z
        .string()
        .trim()
        .min(1, "A ticker is needed for the daily price.")
        .transform((v) => v.toUpperCase()),
    })
    .nullish(),
  units: decimalString,
  totalEUR: decimalString,
  date: isoDate,
  from: cashTarget,
  note: optionalText,
});

export async function buyInvestment(input: unknown, now = new Date()) {
  const value = buySchema.parse(input);
  if (value.date > utcDate(now)) throw new RecordError("The date can't be in the future.");
  return intentTransaction(async (tx) => {
    let holding;
    if (value.holdingId === "new") {
      if (!value.newHolding) throw new RecordError("Fill in the new investment's details.");
      const owner = await liveAccount(tx, value.newHolding.accountId);
      if (owner.type === "manual") {
        throw new RecordError("Investments live in a broker, bank or pension account.");
      }
      [holding] = await tx
        .insert(holdings)
        .values({
          accountId: owner.id,
          isin: value.newHolding.ticker,
          ticker: value.newHolding.ticker,
          name: value.newHolding.name,
          openingQuantity: "0",
          openingAsOf: value.date,
        })
        .returning();
    } else {
      holding = await liveHolding(tx, value.holdingId);
    }
    const account = await liveAccount(tx, holding.accountId);
    const label = holdingLabel(holding);
    if (value.date < holding.openingAsOf) {
      throw new RecordError(
        `${label} was added on ${holding.openingAsOf} with the units you held then. To record what an earlier purchase cost, add a purchase lot on the investment instead.`,
      );
    }
    const units = dec(value.units);
    const total = dec(value.totalEUR);
    const lines: ActivityLine[] = [];

    if (value.from === "none") {
      const { units: held } = await unitsOn(tx, holding.id, value.date, utcDate(now));
      await appendObservationTx(
        tx,
        {
          assetType: "holding",
          assetId: holding.id,
          value: held.plus(units).toString(),
          valuedAt: value.date,
          note: `Bought ${formatUnits(units)}`,
        },
        now,
      );
      lines.push({ label: "Cash", value: "no balance changed" });
    } else {
      let source = account.name;
      if (value.from !== "same" && value.from !== account.id) {
        const payer = await liveAccount(tx, value.from);
        await appendTransferTx(
          tx,
          {
            fromAccountId: payer.id,
            toAccountId: account.id,
            amount: total.toFixed(2),
            occurredAt: value.date,
            note: `For ${label}`,
          },
          now,
        );
        source = payer.name;
      }
      await appendMovementTx(
        tx,
        {
          type: "buy",
          accountId: account.id,
          holdingId: holding.id,
          quantity: units.toString(),
          amount: total.toFixed(2),
          occurredAt: value.date,
          note: value.note,
        },
        now,
      );
      lines.push({ label: "Paid from", value: `${source} (−${euro(total)})` });
    }

    await tx.insert(taxLots).values({
      holdingId: holding.id,
      buyDate: value.date,
      quantity: units.toString(),
      price: total.dividedBy(units).toString(),
      fees: "0",
      fxRate: "1",
      costBasisEUR: total.toFixed(2),
    });
    lines.push({ label: "Purchase lot", value: `${formatUnits(units)} at ${euro(total)}` });

    await finishChange(tx, now, {
      asOf: value.date,
      kind: "buy",
      title: `Bought ${formatUnits(units)} ${label} for ${euro(total)}`,
      lines,
      note: value.note,
    });
    return holding;
  });
}

// --- Moved money between your accounts --------------------------------------

export const moveSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: decimalString,
  date: isoDate,
  note: optionalText,
});

export async function moveMoney(input: unknown, now = new Date()) {
  const value = moveSchema.parse(input);
  return intentTransaction(async (tx) => {
    const from = await liveAccount(tx, value.fromAccountId);
    const to = await liveAccount(tx, value.toAccountId);
    const later = [from, to].find((row) => row.openingAsOf > value.date);
    if (later) {
      throw new RecordError(
        `${later.name} was added on ${later.openingAsOf} with its balance at that date, so this move is already reflected there. If the other balance is out of date, update it instead.`,
      );
    }
    await appendTransferTx(
      tx,
      {
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: dec(value.amount).toFixed(2),
        occurredAt: value.date,
        note: value.note,
      },
      now,
    );
    return finishChange(tx, now, {
      asOf: value.date,
      kind: "move",
      title: `Moved ${euro(value.amount)} from ${from.name} to ${to.name}`,
      note: value.note,
    });
  });
}

// --- Sales and tax ----------------------------------------------------------

export async function setSaleCostBasis(input: unknown, now = new Date()) {
  const value = z
    .object({ saleId: z.string().min(1), costBasisEUR: nonNegativeDecimalString })
    .parse(input);
  return intentTransaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, value.saleId)).limit(1);
    if (!sale || sale.voidedAt) throw new RecordError("That sale doesn't exist.");
    await tx
      .update(sales)
      .set({ costBasisEUR: dec(value.costBasisEUR).toFixed(2), costBasisSource: "manual" })
      .where(eq(sales.id, sale.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "tax",
      title: `Set the cost basis of a ${sale.soldAt} sale to ${euro(value.costBasisEUR)}`,
    });
  });
}

// Removes a sale from the tax estimate only. Balances and units are not
// touched; fix those by confirming the right values.
export async function voidSale(input: unknown, now = new Date()) {
  const value = z.object({ saleId: z.string().min(1) }).parse(input);
  return intentTransaction(async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, value.saleId)).limit(1);
    if (!sale || sale.voidedAt) throw new RecordError("That sale doesn't exist.");
    await tx.update(sales).set({ voidedAt: now }).where(eq(sales.id, sale.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "tax",
      title: `Removed a ${sale.soldAt} sale from the tax estimate`,
    });
  });
}

export const taxPaidSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  amountEUR: nonNegativeDecimalString,
  paidAt: isoDate,
  fromAccountId: z.string().min(1).nullish(),
});

export async function markTaxPaid(input: unknown, now = new Date()) {
  const value = taxPaidSchema.parse(input);
  return intentTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(taxSettlements)
      .where(and(eq(taxSettlements.year, value.year), isNull(taxSettlements.voidedAt)))
      .limit(1);
    if (existing) throw new RecordError(`${value.year} is already marked paid.`);
    await tx.insert(taxSettlements).values({
      year: value.year,
      paidAt: value.paidAt,
      amountEUR: dec(value.amountEUR).toFixed(2),
    });
    const lines: ActivityLine[] = [];
    if (value.fromAccountId && dec(value.amountEUR).greaterThan(0)) {
      const account = await liveAccount(tx, value.fromAccountId);
      await appendMovementTx(
        tx,
        {
          type: "withdraw",
          accountId: account.id,
          amount: dec(value.amountEUR).toFixed(2),
          occurredAt: value.paidAt,
          note: `${value.year} tax`,
        },
        now,
      );
      lines.push({ label: "Paid from", value: `${account.name} (−${euro(value.amountEUR)})` });
    }
    return finishChange(tx, now, {
      asOf: value.paidAt,
      kind: "tax",
      title: `Paid ${value.year} tax: ${euro(value.amountEUR)}`,
      lines,
    });
  });
}

export async function undoTaxPaid(input: unknown, now = new Date()) {
  const value = z.object({ year: z.coerce.number().int() }).parse(input);
  return intentTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(taxSettlements)
      .where(and(eq(taxSettlements.year, value.year), isNull(taxSettlements.voidedAt)))
      .limit(1);
    if (!existing) throw new RecordError(`${value.year} isn't marked paid.`);
    await tx
      .update(taxSettlements)
      .set({ voidedAt: now })
      .where(eq(taxSettlements.id, existing.id));
    return finishChange(tx, now, {
      asOf: utcDate(now),
      kind: "tax",
      title: `Unmarked ${value.year} tax as paid`,
      lines: [{ label: "Note", value: "any balance it reduced stays as it is" }],
    });
  });
}

// --- Closing things ---------------------------------------------------------

export const closeAccountSchema = z.object({
  accountId: z.string().min(1),
  // Where a remaining balance went; null = set it to zero.
  moveTo: z.string().min(1).nullish(),
});

export async function closeAccount(input: unknown, now = new Date()) {
  const value = closeAccountSchema.parse(input);
  const today = utcDate(now);
  return intentTransaction(async (tx) => {
    const account = await liveAccount(tx, value.accountId);
    const live = await tx
      .select()
      .from(holdings)
      .where(and(eq(holdings.accountId, account.id), isNull(holdings.disposedAt)));
    if (live.length > 0) {
      throw new RecordError(
        `${account.name} still holds ${live.map(holdingLabel).join(", ")}. Sell or remove them first.`,
      );
    }
    const state = await currentState(tx, today);
    const balance = dec(state.cashByAccount[account.id] ?? 0);
    const lines: ActivityLine[] = [];
    if (!balance.isZero()) {
      if (value.moveTo && balance.greaterThan(0)) {
        const target = await liveAccount(tx, value.moveTo);
        await appendTransferTx(
          tx,
          {
            fromAccountId: account.id,
            toAccountId: target.id,
            amount: balance.toFixed(2),
            occurredAt: today,
            note: `Closing ${account.name}`,
          },
          now,
        );
        lines.push({ label: "Moved", value: `${euro(balance)} to ${target.name}` });
      } else {
        await appendObservationTx(
          tx,
          { assetType: "account", assetId: account.id, value: "0", valuedAt: today, note: "Closed" },
          now,
        );
        lines.push({ label: "Balance", value: `${euro(balance)} → €0` });
      }
    }
    await tx.update(accounts).set({ disposedAt: now }).where(eq(accounts.id, account.id));
    return finishChange(tx, now, {
      asOf: today,
      kind: "close",
      title: `Closed ${account.name}`,
      lines,
    });
  });
}

// For a position that left without a sale (moved broker, written off). A sale
// belongs in sellInvestment so its gain is counted.
export async function removeHolding(input: unknown, now = new Date()) {
  const value = z.object({ holdingId: z.string().min(1) }).parse(input);
  const today = utcDate(now);
  return intentTransaction(async (tx) => {
    const holding = await liveHolding(tx, value.holdingId);
    const { units } = await unitsOn(tx, holding.id, today, today);
    if (!units.isZero()) {
      await appendObservationTx(
        tx,
        { assetType: "holding", assetId: holding.id, value: "0", valuedAt: today, note: "Removed" },
        now,
      );
    }
    await tx.update(holdings).set({ disposedAt: now }).where(eq(holdings.id, holding.id));
    return finishChange(tx, now, {
      asOf: today,
      kind: "close",
      title: `Removed ${holdingLabel(holding)}`,
      lines: units.isZero() ? [] : [{ label: "Units", value: `${formatUnits(units)} → 0 (no sale recorded)` }],
    });
  });
}

export const sellPropertySchema = z.object({
  propertyId: z.string().min(1),
  proceedsEUR: nonNegativeDecimalString,
  toAccountId: z.string().min(1).nullish(),
  date: isoDate,
  note: optionalText,
});

// Net proceeds land in an account; the property and its mortgages close.
// Capital gains on property are not estimated: the rules are too particular.
export async function sellProperty(input: unknown, now = new Date()) {
  const value = sellPropertySchema.parse(input);
  return intentTransaction(async (tx) => {
    const [property] = await tx
      .select()
      .from(properties)
      .where(eq(properties.id, value.propertyId))
      .limit(1);
    if (!property || property.disposedAt) throw new RecordError("That property doesn't exist or is closed.");
    const lines: ActivityLine[] = [];
    if (value.toAccountId && dec(value.proceedsEUR).greaterThan(0)) {
      const account = await liveAccount(tx, value.toAccountId);
      await appendMovementTx(
        tx,
        {
          type: "deposit",
          accountId: account.id,
          amount: dec(value.proceedsEUR).toFixed(2),
          occurredAt: value.date,
          note: `Sale of ${property.name}`,
        },
        now,
      );
      lines.push({ label: "Money to", value: `${account.name} (+${euro(value.proceedsEUR)})` });
    }
    await tx.update(properties).set({ disposedAt: now }).where(eq(properties.id, property.id));
    await tx
      .update(liabilities)
      .set({ disposedAt: now })
      .where(and(eq(liabilities.propertyId, property.id), isNull(liabilities.disposedAt)));
    return finishChange(tx, now, {
      asOf: value.date,
      kind: "sell",
      title: `Sold ${property.name} for ${euro(value.proceedsEUR)} net`,
      lines,
      note: value.note,
    });
  });
}

export const closeSimpleSchema = z.object({
  id: z.string().min(1),
  // Cash that moved with the closure: paid from (debt) or received into (asset).
  accountId: z.string().min(1).nullish(),
  amountEUR: nonNegativeDecimalString.nullish(),
});

export async function closeLiability(input: unknown, now = new Date()) {
  const value = closeSimpleSchema.parse(input);
  const today = utcDate(now);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(liabilities).where(eq(liabilities.id, value.id)).limit(1);
    if (!row || row.disposedAt) throw new RecordError("That debt doesn't exist or is closed.");
    const lines: ActivityLine[] = [];
    if (value.accountId && value.amountEUR && dec(value.amountEUR).greaterThan(0)) {
      const account = await liveAccount(tx, value.accountId);
      await appendMovementTx(
        tx,
        { type: "withdraw", accountId: account.id, amount: dec(value.amountEUR).toFixed(2), occurredAt: today, note: `Repaid ${row.name ?? "debt"}` },
        now,
      );
      lines.push({ label: "Paid from", value: `${account.name} (−${euro(value.amountEUR)})` });
    }
    await tx.update(liabilities).set({ disposedAt: now }).where(eq(liabilities.id, row.id));
    return finishChange(tx, now, {
      asOf: today,
      kind: "close",
      title: `Repaid ${row.name ?? "debt"}`,
      lines,
    });
  });
}

export async function closeOtherAsset(input: unknown, now = new Date()) {
  const value = closeSimpleSchema.parse(input);
  const today = utcDate(now);
  return intentTransaction(async (tx) => {
    const [row] = await tx.select().from(otherAssets).where(eq(otherAssets.id, value.id)).limit(1);
    if (!row || row.disposedAt) throw new RecordError("That asset doesn't exist or is closed.");
    const lines: ActivityLine[] = [];
    if (value.accountId && value.amountEUR && dec(value.amountEUR).greaterThan(0)) {
      const account = await liveAccount(tx, value.accountId);
      await appendMovementTx(
        tx,
        { type: "deposit", accountId: account.id, amount: dec(value.amountEUR).toFixed(2), occurredAt: today, note: `Sold ${row.name}` },
        now,
      );
      lines.push({ label: "Money to", value: `${account.name} (+${euro(value.amountEUR)})` });
    }
    await tx.update(otherAssets).set({ disposedAt: now }).where(eq(otherAssets.id, row.id));
    return finishChange(tx, now, {
      asOf: today,
      kind: "close",
      title: `Removed ${row.name}`,
      lines,
    });
  });
}

