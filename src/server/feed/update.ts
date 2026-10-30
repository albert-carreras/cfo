import { createId } from "@paralleldrive/cuid2";
import { computeSnapshot, snapshotStatus } from "@/calc/snapshot";
import { db } from "../db";
import { fxRates, holdings, marketPrices } from "../db/schema";
import { loadFacts } from "../facts";
import { persistSnapshot } from "../snapshots";
import { eurPerUnit, fetchEcbDaily } from "./ecb";
import { fetchQuote } from "./quotes";

// The daily feed: a price for every live investment with a ticker, the ECB
// FX rates those prices need, then today's snapshot. One symbol failing never
// blocks the rest; a stale price shows up on the overview's attention list.

export type PriceResult = {
  symbol: string;
  ok: boolean;
  price?: string;
  currency?: string;
  priceAsOf?: string;
  error?: string;
};

// Fetch and store the latest price for one holding. Used by the daily run and
// right after a holding is added or its ticker changes, so it is valued at
// once instead of the next morning.
export async function refreshPrice(
  holding: { isin: string; ticker: string | null },
  options: { withFx?: boolean } = {},
): Promise<PriceResult> {
  if (!holding.ticker) return { symbol: holding.isin, ok: false, error: "no ticker" };
  try {
    const quote = await fetchQuote(holding.ticker);
    await db
      .insert(marketPrices)
      .values({ isin: holding.isin, price: quote.price, currency: quote.currency, asOf: quote.asOf })
      .onConflictDoUpdate({
        target: [marketPrices.isin, marketPrices.asOf],
        set: { price: quote.price, currency: quote.currency },
      });
    if (quote.currency !== "EUR" && options.withFx !== false) {
      await refreshFx([quote.currency]);
    }
    return {
      symbol: holding.ticker,
      ok: true,
      price: quote.price,
      currency: quote.currency,
      priceAsOf: quote.asOf,
    };
  } catch (error) {
    return {
      symbol: holding.ticker,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshFx(currencies: string[]): Promise<string[]> {
  if (currencies.length === 0) return [];
  const errors: string[] = [];
  try {
    const ecb = await fetchEcbDaily();
    for (const quote of currencies) {
      const rate = eurPerUnit(ecb, quote);
      if (rate === null) {
        errors.push(`no ECB rate for ${quote}`);
        continue;
      }
      await db
        .insert(fxRates)
        .values({ base: "EUR", quote, rate, asOf: ecb.asOf })
        .onConflictDoUpdate({ target: [fxRates.quote, fxRates.asOf], set: { rate } });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

// Recompute and store today's snapshot outside any change, e.g. after a
// freshly fetched price.
export async function recordTodaySnapshot(now = new Date()) {
  const asOf = now.toISOString().slice(0, 10);
  const { facts } = await loadFacts(db, asOf);
  const snapshot = computeSnapshot({ snapshotId: createId(), asOf, facts });
  await persistSnapshot(snapshot, { computedAt: now });
  return snapshot;
}

export async function runDailyUpdate(now = new Date()) {
  const asOf = now.toISOString().slice(0, 10);
  const live = (await db.select().from(holdings)).filter((row) => !row.disposedAt);

  const prices: PriceResult[] = [];
  const currencies = new Set<string>();
  for (const holding of live) {
    if (!holding.ticker) continue;
    const result = await refreshPrice(holding, { withFx: false });
    prices.push(result);
    if (result.currency && result.currency !== "EUR") currencies.add(result.currency);
  }
  const fxErrors = await refreshFx([...currencies]);
  const snapshot = await recordTodaySnapshot(now);

  return {
    asOf,
    prices,
    fxErrors,
    snapshotId: snapshot.snapshotId,
    status: snapshotStatus(snapshot),
  };
}
