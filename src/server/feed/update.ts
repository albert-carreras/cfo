import { createId } from "@paralleldrive/cuid2";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { assumptions, fxRates, holdings, marketPrices } from "../db/schema";
import { loadFacts } from "../facts";
import {
  isReviewDue,
  latestSnapshot,
  persistSnapshot,
  storedSnapshotResult,
} from "../snapshots";
import { computeSnapshot } from "@/calc/snapshot";
import {
  materialChange,
  snapshotSummary,
  type MaterialChangeValue,
} from "@/calc/materialChange";
import { runPicture } from "../picture";
import { decideDailyNotifications, sendNotification } from "../notify";
import { setAssumption } from "../assumptions";
import { eurPerUnit, fetchEcbDaily } from "./ecb";
import {
  ECB_ASSUMPTION_SERIES,
  assumptionFeedDue,
  fetchEcbSeries,
  latestAsFraction,
} from "./ecbSeries";
import { fetchQuote } from "./quotes";

// The daily internal update (architecture.md: "daily internal, monthly visible"):
//   1. fetch a price for every live holding with a feed symbol, upsert into
//      market_prices; fetch ECB FX once, upsert the currencies those prices need
//   2. recompute the full snapshot and persist it as `internal` (the running
//      history the confidence score and material-change detection feed on)
//   3. promote a `strategic` (user-visible) snapshot only when the month rolled
//      over — or off-cycle when something MATERIAL changed (the calm firewall)
// One symbol failing never blocks the rest; failures are reported per symbol
// and stale prices surface through data_quality → the Data-stale status.

export type DailyUpdateResult = {
  asOf: string;
  prices: {
    isin: string;
    symbol: string | null;
    ok: boolean;
    price?: string;
    currency?: string;
    priceAsOf?: string;
    error?: string;
  }[];
  fx: { quote: string; rate: string; asOf: string }[];
  fxErrors: string[];
  // The monthly macro refresh (inflation, interestRate from the ECB Data
  // Portal) — empty arrays = nothing was due this run.
  assumptionFeed: {
    written: { key: string; value: string; period: string }[];
    errors: string[];
  };
  internalSnapshotId: string;
  status: string;
  materialChange: MaterialChangeValue;
  strategic: { written: boolean; reason: string | null };
  // The standing reassurance narrative, regenerated with each promotion.
  // `generated:false` with no error = nothing promoted or already current.
  picture: { generated: boolean; scope: string | null; error: string | null };
};

export async function runDailyUpdate(now = new Date()): Promise<DailyUpdateResult> {
  const asOf = now.toISOString().slice(0, 10);

  // --- 0. Monthly macro assumptions (inflation, interestRate) ---
  // Idempotent: refresh only when the row's last review predates this month,
  // so the daily cron yields one feed write per month per key. Runs before
  // the snapshot recompute so the internal snapshot sees the fresh values; a
  // feed failure never blocks the rest of the update.
  const assumptionFeed: DailyUpdateResult["assumptionFeed"] = {
    written: [],
    errors: [],
  };
  const feedKeys = Object.keys(ECB_ASSUMPTION_SERIES) as (keyof typeof ECB_ASSUMPTION_SERIES)[];
  const feedRows = await db
    .select()
    .from(assumptions)
    .where(inArray(assumptions.key, feedKeys));
  for (const key of feedKeys) {
    const row = feedRows.find((r) => r.key === key) ?? null;
    if (!assumptionFeedDue(row?.lastReviewedAt ?? null, asOf)) continue;
    try {
      const latest = latestAsFraction(await fetchEcbSeries(key), asOf);
      if (latest === null) {
        assumptionFeed.errors.push(`${key}: no observation on or before ${asOf}`);
        continue;
      }
      await setAssumption(
        { key, value: latest.fraction, source: "feed:ecb" },
        { now },
      );
      assumptionFeed.written.push({ key, value: latest.fraction, period: latest.period });
    } catch (err) {
      assumptionFeed.errors.push(
        `${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- 1. Prices for every live holding with a feed symbol ---
  const holds = (await db.select().from(holdings)).filter((h) => !h.disposedAt);

  const priceResults: DailyUpdateResult["prices"] = [];
  const currenciesNeeded = new Set<string>();

  for (const h of holds) {
    if (!h.ticker) {
      priceResults.push({
        isin: h.isin,
        symbol: null,
        ok: false,
        error: "no ticker (feed symbol) on the holding",
      });
      continue;
    }
    try {
      const q = await fetchQuote(h.ticker);
      await db
        .insert(marketPrices)
        .values({ isin: h.isin, price: q.price, currency: q.currency, asOf: q.asOf })
        .onConflictDoUpdate({
          target: [marketPrices.isin, marketPrices.asOf],
          set: { price: q.price, currency: q.currency },
        });
      if (q.currency !== "EUR") currenciesNeeded.add(q.currency);
      priceResults.push({
        isin: h.isin,
        symbol: h.ticker,
        ok: true,
        price: q.price,
        currency: q.currency,
        priceAsOf: q.asOf,
      });
    } catch (err) {
      priceResults.push({
        isin: h.isin,
        symbol: h.ticker,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- FX (one ECB fetch covers every currency the prices need) ---
  const fxWritten: DailyUpdateResult["fx"] = [];
  const fxErrors: string[] = [];
  if (currenciesNeeded.size > 0) {
    try {
      const ecb = await fetchEcbDaily();
      for (const quote of currenciesNeeded) {
        const rate = eurPerUnit(ecb, quote);
        if (rate === null) {
          fxErrors.push(`no ECB rate for ${quote}`);
          continue;
        }
        await db
          .insert(fxRates)
          .values({ base: "EUR", quote, rate, asOf: ecb.asOf })
          .onConflictDoUpdate({
            target: [fxRates.quote, fxRates.asOf],
            set: { rate },
          });
        fxWritten.push({ quote, rate, asOf: ecb.asOf });
      }
    } catch (err) {
      fxErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // --- 2. Recompute on the fresh feed and persist the internal snapshot ---
  const lastStrategic = await latestSnapshot("strategic");
  // The previous internal status, read before the new row lands — a status
  // TRANSITION (not a level) is what notifies, so silence stays meaningful.
  const lastInternal = await latestSnapshot("internal");
  const previousStatus = lastInternal
    ? storedSnapshotResult(lastInternal).status.value.status
    : null;
  const { facts, propertyNameById, holdingNameById } = await loadFacts();
  // The daily internal row is history for material-change/confidence — it
  // doesn't carry the decision scenarios (the strategic one below does).
  const internalSnapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: isReviewDue(lastStrategic?.computedAt ?? null, asOf),
    facts,
    withScenarios: false,
  });
  await persistSnapshot("internal", internalSnapshot, {
    computedAt: now,
    dedupeKey: `internal:${asOf}`,
  });

  // --- 3. Material-change detection + the monthly strategic promotion ---
  const prev = lastStrategic
    ? snapshotSummary(storedSnapshotResult(lastStrategic))
    : null;
  const mc = materialChange({
    snapshotId: internalSnapshot.snapshotId,
    previous: prev,
    current: snapshotSummary(internalSnapshot),
  });

  const monthRolled = prev !== null && prev.asOf.slice(0, 7) < asOf.slice(0, 7);
  const reason =
    prev === null
      ? "first strategic snapshot"
      : monthRolled
        ? "month rolled over"
        : mc.value.material
          ? "material change"
          : null;

  let picture: DailyUpdateResult["picture"] = {
    generated: false,
    scope: null,
    error: null,
  };
  if (reason !== null) {
    const strategicSnapshot = computeSnapshot({
      snapshotId: createId(),
      asOf,
      reviewDue: isReviewDue(lastStrategic?.computedAt ?? null, asOf),
      facts,
      propertyNameById,
      holdingNameById,
    });
    await persistSnapshot("strategic", strategicSnapshot, {
      computedAt: now,
      dedupeKey: `strategic:${asOf}`,
    });
    // The standing reassurance narrative follows the promotion. runPicture
    // never throws and resolves a missing key before any provider code — a
    // provider outage can never fail the daily update.
    const pic = await runPicture({ force: false });
    picture = pic.ok
      ? {
          generated: !pic.skipped,
          scope: pic.skipped ? null : pic.scope,
          error: pic.skipped ? null : pic.llmError,
        }
      : { generated: false, scope: null, error: pic.reason };
  }

  // --- 4. Push notifications (ntfy) — pure rules decide, the send is
  // fire-and-forget and can never fail the update. ---
  for (const n of decideDailyNotifications({
    previousStatus,
    status: internalSnapshot.status.value,
    strategicReason: reason,
    materialChange: mc.value,
    priceFailures: priceResults.filter((p) => !p.ok),
    fxErrors,
    assumptionFeedErrors: assumptionFeed.errors,
  })) {
    await sendNotification(n);
  }

  return {
    asOf,
    prices: priceResults,
    fx: fxWritten,
    fxErrors,
    assumptionFeed,
    internalSnapshotId: internalSnapshot.snapshotId,
    status: internalSnapshot.status.value.status,
    materialChange: mc.value,
    strategic: { written: reason !== null, reason },
    picture,
  };
}
