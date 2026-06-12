import { dec } from "@/calc/money";

// Price provider: the Yahoo Finance chart API (free, no key; an implementation
// detail recorded in docs/architecture.md, swappable behind fetchQuote). A
// holding's `ticker` IS its feed symbol — exchange-suffixed where needed
// (e.g. "VWCE.DE", plain "SMH" for US listings). The parser is pure and tested;
// only the fetch touches the network.

export type Quote = {
  symbol: string;
  price: string; // in `currency`, full precision as published
  currency: string;
  asOf: string; // YYYY-MM-DD (UTC) of the market timestamp
};

// Minimal slice of the chart response we rely on.
type ChartResponse = {
  chart?: {
    error?: { description?: string } | null;
    result?: {
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number; // unix seconds
      };
    }[];
  };
};

export function parseQuote(json: unknown, symbol: string): Quote {
  const meta = (json as ChartResponse).chart?.result?.[0]?.meta;
  const error = (json as ChartResponse).chart?.error;
  if (error || !meta) {
    throw new Error(
      `quote ${symbol}: ${error?.description ?? "no result in chart response"}`,
    );
  }
  const { currency, regularMarketPrice, regularMarketTime } = meta;
  if (
    !currency ||
    typeof regularMarketPrice !== "number" ||
    !Number.isFinite(regularMarketPrice) ||
    typeof regularMarketTime !== "number"
  ) {
    throw new Error(`quote ${symbol}: incomplete meta (price/currency/time)`);
  }
  // A quote for a DIFFERENT symbol than requested must never be stored under
  // the requested holding — reject rather than silently price the wrong asset.
  if (meta.symbol && meta.symbol.toUpperCase() !== symbol.toUpperCase()) {
    throw new Error(
      `quote ${symbol}: response is for "${meta.symbol}", not the requested symbol`,
    );
  }
  // A non-positive price is never a real market price; storing it would
  // silently zero the valuation (and a 0-valued line must read as unpriced).
  if (regularMarketPrice <= 0) {
    throw new Error(
      `quote ${symbol}: non-positive price ${regularMarketPrice}`,
    );
  }
  // GBp (pence) → GBP so the FX table stays in whole-currency units.
  const pence = currency === "GBp";
  return {
    symbol: meta.symbol ?? symbol,
    price: pence
      ? dec(regularMarketPrice).dividedBy(100).toString()
      : dec(regularMarketPrice).toString(),
    currency: pence ? "GBP" : currency,
    asOf: new Date(regularMarketTime * 1000).toISOString().slice(0, 10),
  };
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1d&interval=1d`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (cfo personal feed)" },
  });
  if (!res.ok) throw new Error(`quote ${symbol}: HTTP ${res.status}`);
  return parseQuote(await res.json(), symbol);
}
