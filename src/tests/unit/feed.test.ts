import { describe, expect, it } from "vitest";
import { eurPerUnit, parseEcbDailyXml } from "@/server/feed/ecb";
import { parseQuote } from "@/server/feed/quotes";

// The feed's parsers are pure — tested here against fixture payloads so the
// only untested part of the feed is the fetch itself.

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time="2026-06-08">
      <Cube currency="USD" rate="1.0852"/>
      <Cube currency="JPY" rate="169.55"/>
      <Cube currency="GBP" rate="0.8534"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("ECB FX parser", () => {
  it("extracts the business day and the quote-per-EUR rates", () => {
    const daily = parseEcbDailyXml(ECB_XML);
    expect(daily.asOf).toBe("2026-06-08");
    expect(daily.quotePerEur.USD).toBe("1.0852");
    expect(daily.quotePerEur.GBP).toBe("0.8534");
  });

  it("inverts to our EUR-per-unit semantic (amount × rate = EUR)", () => {
    const daily = parseEcbDailyXml(ECB_XML);
    // 1 / 1.0852 = 0.9214891264...
    expect(eurPerUnit(daily, "USD")).toBe("0.92148913");
    expect(eurPerUnit(daily, "CHF")).toBeNull(); // not published that day
  });

  it("rejects a payload with no rates rather than writing garbage", () => {
    expect(() => parseEcbDailyXml("<html>maintenance</html>")).toThrow();
    expect(() =>
      parseEcbDailyXml('<Cube time="2026-06-08"></Cube>'),
    ).toThrow(/no currency rows/);
  });
});

describe("market quote parser", () => {
  const chart = (meta: Record<string, unknown>) => ({
    chart: { result: [{ meta }], error: null },
  });

  it("extracts symbol, price, currency and the market date (UTC)", () => {
    const q = parseQuote(
      chart({
        symbol: "VWCE.DE",
        currency: "EUR",
        regularMarketPrice: 126.18,
        regularMarketTime: 1781013600, // 2026-06-09 UTC
      }),
      "VWCE.DE",
    );
    expect(q).toEqual({
      symbol: "VWCE.DE",
      price: "126.18",
      currency: "EUR",
      asOf: "2026-06-09",
    });
  });

  it("normalises GBp (pence) quotes to GBP", () => {
    const q = parseQuote(
      chart({
        symbol: "VUSA.L",
        currency: "GBp",
        regularMarketPrice: 8770,
        regularMarketTime: 1781013600,
      }),
      "VUSA.L",
    );
    expect(q.currency).toBe("GBP");
    expect(q.price).toBe("87.7");
  });

  it("throws on provider errors and incomplete payloads", () => {
    expect(() =>
      parseQuote({ chart: { result: [], error: { description: "Not Found" } } }, "X"),
    ).toThrow(/Not Found/);
    expect(() => parseQuote(chart({ currency: "EUR" }), "X")).toThrow(/incomplete/);
  });

  it("rejects a quote for a different symbol than requested — never price the wrong asset", () => {
    const meta = {
      symbol: "SMCI",
      currency: "USD",
      regularMarketPrice: 42.5,
      regularMarketTime: 1781013600,
    };
    expect(() => parseQuote(chart(meta), "SMH")).toThrow(/is for "SMCI"/);
    // Same symbol in a different case is the same listing, not a mismatch.
    expect(parseQuote(chart(meta), "smci").symbol).toBe("SMCI");
  });

  it("rejects non-positive prices — a 0 must read as unpriced, not a crash to zero", () => {
    const at = (price: number) =>
      chart({
        symbol: "VWCE.DE",
        currency: "EUR",
        regularMarketPrice: price,
        regularMarketTime: 1781013600,
      });
    expect(() => parseQuote(at(0), "VWCE.DE")).toThrow(/non-positive/);
    expect(() => parseQuote(at(-3.2), "VWCE.DE")).toThrow(/non-positive/);
  });
});
