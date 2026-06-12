import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { dec } from "@/calc/money";
import {
  accounts,
  assumptions,
  holdings,
  liabilities,
  monthlySpend,
  movements,
  plannedEvents,
  properties,
  revaluations,
  taxLots,
} from "./db/schema";
import {
  intentTransaction,
  recomputeAndPromote,
  type DbTransaction,
} from "./quicklog";
import {
  setupInputSchema,
  validateSetupDates,
  type SetupInput,
} from "@/shared/setup";

// The /setup wizard's commit path — the non-destructive sibling of
// scripts/seed.ts. Create-only: it writes the opening baseline onto an EMPTY
// database and promotes the first strategic snapshot; it can never touch an
// existing install (the destructive reseed stays a local script behind the
// cfo.allow_ledger_reset trigger guard). The input contract lives in
// src/shared/setup.ts so the wizard validates with the same schema.

export class SetupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupInputError";
  }
}

// Pure: parsed wizard input → the exact DB rows the commit inserts. Cost basis
// is derived here (price × quantity × fxRate + fees) — never client-supplied.
// The shape mirrors scripts/seed.fixture.ts so the same rows feed both the
// insert and (in tests) toSnapshotFacts + computeSnapshot.
export function buildSetupRows(
  input: SetupInput,
  idFn: () => string = createId,
) {
  const accountRows = input.accounts.map((account) => ({
    id: idFn(),
    type: account.type,
    name: account.name,
    currency: account.currency,
    openingCash: account.openingCash,
    openingAsOf: account.openingAsOf ?? input.baselineAsOf,
  }));

  const holdingRows = input.holdings.map((holding) => ({
    id: idFn(),
    accountId: accountRows[holding.accountIndex].id,
    isin: holding.isin,
    ticker: holding.ticker ?? null,
    name: holding.name,
    currency: holding.currency,
    openingQuantity: holding.openingQuantity,
    openingAsOf: holding.openingAsOf ?? input.baselineAsOf,
  }));

  const taxLotRows = input.holdings.flatMap((holding, index) =>
    holding.lots.map((lot) => ({
      id: idFn(),
      holdingId: holdingRows[index].id,
      buyDate: lot.buyDate,
      quantity: lot.quantity,
      price: lot.price,
      fees: lot.fees,
      fxRate: lot.fxRate,
      costBasisEUR: dec(lot.price)
        .times(lot.quantity)
        .times(lot.fxRate)
        .plus(lot.fees)
        .toString(),
    })),
  );

  const propertyRows = input.properties.map((property) => ({
    id: idFn(),
    name: property.name,
    value: property.value,
    purchasePrice: property.purchasePrice ?? null,
    ownershipPct: property.ownershipPct,
    rentMonthly: property.rentMonthly,
    costsMonthly: property.costsMonthly,
    isPrimaryResidence: property.isPrimaryResidence,
    emotionalValue: null,
    valuedAt: property.valuedAt,
  }));

  const liabilityRows = input.liabilities.map((liability) => ({
    id: idFn(),
    type: "mortgage" as const,
    propertyId:
      liability.propertyIndex != null
        ? propertyRows[liability.propertyIndex].id
        : null,
    rate: liability.rate ?? null,
    balance: liability.balance,
    payment: liability.payment ?? null,
  }));

  const assumptionRows = input.assumptions.map((assumption) => ({
    id: idFn(),
    key: assumption.key,
    value: assumption.value ?? null,
    dateValue: assumption.dateValue ?? null,
    source: assumption.source,
    lastReviewedAt: input.baselineAsOf,
  }));

  const plannedEventRows = input.plannedEvents.map((event) => ({
    id: idFn(),
    type: event.type,
    date: event.date,
    amount: event.amount,
    probability: event.probability,
    includedInBaseCase: event.includedInBaseCase,
    note: event.note ?? null,
  }));

  return {
    accounts: accountRows,
    holdings: holdingRows,
    taxLots: taxLotRows,
    properties: propertyRows,
    liabilities: liabilityRows,
    assumptions: assumptionRows,
    plannedEvents: plannedEventRows,
  };
}

const BASELINE_TABLES = [
  { table: accounts, name: "accounts" },
  { table: holdings, name: "holdings" },
  { table: taxLots, name: "tax lots" },
  { table: properties, name: "properties" },
  { table: liabilities, name: "liabilities" },
  { table: assumptions, name: "assumptions" },
  { table: movements, name: "movements" },
  { table: revaluations, name: "revaluations" },
  { table: monthlySpend, name: "monthly spend" },
  { table: plannedEvents, name: "planned events" },
];

// A fixed advisory-lock key (any constant) serializes concurrent commits.
const SETUP_LOCK_KEY = 743_201_188;

async function assertEmptyBaseline(tx: DbTransaction) {
  for (const { table, name } of BASELINE_TABLES) {
    const [row] = await tx.select({ id: table.id }).from(table).limit(1);
    if (row) {
      throw new SetupInputError(
        `the database already has ${name} — setup is create-only; manage existing data via the app`,
      );
    }
  }
}

export async function commitSetup(input: unknown, now = new Date()) {
  const parsed = setupInputSchema.parse(input);
  const today = now.toISOString().slice(0, 10);
  const dateErrors = validateSetupDates(parsed, today);
  if (dateErrors.length > 0) {
    throw new SetupInputError(dateErrors.join("; "));
  }

  const rows = buildSetupRows(parsed);

  return intentTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    await assertEmptyBaseline(tx);

    await tx.insert(accounts).values(rows.accounts);
    if (rows.holdings.length > 0) await tx.insert(holdings).values(rows.holdings);
    if (rows.taxLots.length > 0) await tx.insert(taxLots).values(rows.taxLots);
    if (rows.properties.length > 0) {
      await tx.insert(properties).values(rows.properties);
    }
    if (rows.liabilities.length > 0) {
      await tx.insert(liabilities).values(rows.liabilities);
    }
    await tx.insert(assumptions).values(rows.assumptions);
    if (rows.plannedEvents.length > 0) {
      await tx.insert(plannedEvents).values(rows.plannedEvents);
    }

    const snapshot = await recomputeAndPromote(tx, now);
    return {
      snapshotId: snapshot.snapshotId,
      counts: {
        accounts: rows.accounts.length,
        holdings: rows.holdings.length,
        taxLots: rows.taxLots.length,
        properties: rows.properties.length,
        liabilities: rows.liabilities.length,
        assumptions: rows.assumptions.length,
        plannedEvents: rows.plannedEvents.length,
      },
    };
  });
}
