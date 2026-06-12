import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  fixture as syntheticFixture,
  toSnapshotFacts,
  FIXTURE_AS_OF as SYNTHETIC_AS_OF,
  type Fixture,
} from "./seed.fixture";
import { db } from "../src/server/db";
import { computeSnapshot } from "../src/calc/snapshot";
import {
  accounts,
  assumptions,
  fxRates,
  holdings,
  liabilities,
  marketPrices,
  monthlySpend,
  movements,
  plannedEvents,
  properties,
  revaluations,
  snapshots,
  taxLots,
} from "../src/server/db/schema";

// Loads real data from a git-ignored scripts/seed.local.ts when present,
// otherwise the committed synthetic fixture (== the test fixture). Idempotent:
// wipes the tables in reverse-FK order, then inserts.

const here = path.dirname(fileURLToPath(import.meta.url));
const localPath = path.join(here, "seed.local.ts");

type SeedModule = { fixture: Fixture; FIXTURE_AS_OF: string };

async function loadSeed(): Promise<{ data: Fixture; asOf: string; source: string }> {
  if (existsSync(localPath)) {
    // file:// URL (a runtime expression, not a literal) so tsc never tries to
    // resolve the git-ignored module — a fresh clone has only the fixture.
    const mod = (await import(pathToFileURL(localPath).href)) as SeedModule;
    return {
      data: mod.fixture,
      asOf: mod.FIXTURE_AS_OF,
      source: "seed.local.ts (real data)",
    };
  }
  return {
    data: syntheticFixture,
    asOf: SYNTHETIC_AS_OF,
    source: "seed.fixture.ts (synthetic)",
  };
}

async function main() {
  // Best-effort .env load (Node 20.12+). Harmless if DATABASE_URL is already set.
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — rely on the ambient environment
  }

  const { data: fixture, asOf, source } = await loadSeed();
  console.log(`Loading ${source}`);

  const snap = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: false,
    facts: toSnapshotFacts(fixture),
  });

  await db.transaction(async (tx) => {
    // The ledger is append-only in normal operation. Seeding is the one explicit
    // destructive reset path, scoped to this transaction.
    await tx.execute(sql`select set_config('cfo.allow_ledger_reset', 'on', true)`);

    await tx.delete(snapshots);
    await tx.delete(revaluations);
    await tx.delete(monthlySpend);
    await tx.delete(fxRates);
    await tx.delete(marketPrices);
    await tx.delete(movements);
    await tx.delete(plannedEvents);
    await tx.delete(taxLots);
    await tx.delete(liabilities);
    await tx.delete(holdings);
    await tx.delete(assumptions);
    await tx.delete(properties);
    await tx.delete(accounts);

    // Guard empty arrays: drizzle's .values([]) is an error, and real data may
    // legitimately have no movements/liabilities/fx yet.
    await tx.insert(accounts).values(fixture.accounts);
    await tx.insert(holdings).values(fixture.holdings);
    if (fixture.taxLots?.length) await tx.insert(taxLots).values(fixture.taxLots);
    if (fixture.properties.length)
      await tx.insert(properties).values(fixture.properties);
    if (fixture.liabilities.length)
      await tx.insert(liabilities).values(fixture.liabilities);
    await tx.insert(assumptions).values(fixture.assumptions);
    if (fixture.movements.length) await tx.insert(movements).values(fixture.movements);
    if (fixture.monthlySpend.length)
      await tx
        .insert(monthlySpend)
        .values(
          fixture.monthlySpend.map((r) => ({
            ...r,
            createdAt: new Date(r.createdAt),
          })),
        );
    if (fixture.revaluations?.length)
      await tx.insert(revaluations).values(
        fixture.revaluations.map((r) => ({
          ...r,
          createdAt: new Date(r.createdAt),
        })),
      );
    if (fixture.prices.length) await tx.insert(marketPrices).values(fixture.prices);
    if (fixture.fx.length) await tx.insert(fxRates).values(fixture.fx);
    if (fixture.plannedEvents?.length)
      await tx.insert(plannedEvents).values(fixture.plannedEvents);

    // Pin an initial strategic snapshot so the home screen has a reference point.
    await tx.insert(snapshots).values({
      id: snap.snapshotId,
      kind: "strategic",
      status: snap.status.value.status,
      result: snap,
      asOf,
      dedupeKey: `strategic:${asOf}`,
      computedAt: new Date(asOf),
    });
  });

  console.log(
    `Seeded: ${fixture.accounts.length} accounts, ${fixture.holdings.length} holdings, ` +
      `${fixture.properties.length} properties, ${fixture.taxLots?.length ?? 0} tax lots, ` +
      `${fixture.movements.length} movements, ` +
      `${fixture.revaluations?.length ?? 0} revaluations, ` +
      `${fixture.monthlySpend.length} monthly-spend rows, ` +
      `${fixture.plannedEvents?.length ?? 0} planned events. ` +
      `Baseline ${fixture.accounts[0].openingAsOf}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
