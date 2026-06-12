import { describe, expect, it } from "vitest";
import {
  assumptionFeedDue,
  latestAsFraction,
  parseSdmxCsv,
} from "@/server/feed/ecbSeries";
import { ASSUMPTION_RANGES } from "@/shared/setup";
import {
  ASSUMPTION_DESCRIPTIONS,
  EDITABLE_ASSUMPTION_KEYS,
  FEED_ASSUMPTION_KEYS,
} from "@/shared/assumptionKeys";

// The macro-series feed's parsers are pure — tested against real-shaped SDMX
// csvdata fixtures so the only untested part of the feed is the fetch itself.

// Spain HICP annual rate (flow HICP) — note the trailing free-text columns.
const HICP_CSV = `KEY,FREQ,REF_AREA,ADJUSTMENT,ICP_ITEM,DATA_PROVIDER,ICP_SUFFIX,TIME_PERIOD,OBS_VALUE,EMBARGO_TIME,COMMENT_OBS,TITLE
HICP.M.ES.N.000000.4D0.ANR,M,ES,N,000000,4D0,ANR,2026-04,3.5,,,"Spain - HICP - Total, Annual rate of change"
HICP.M.ES.N.000000.4D0.ANR,M,ES,N,000000,4D0,ANR,2026-05,3.6,,,"Spain - HICP - Total, Annual rate of change"
`;

// Deposit facility "date of changes" (flow FM) — an announced FUTURE change
// appears as a future-dated observation that must not win yet.
const DFR_CSV = `KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS
FM.B.U2.EUR.4F.KR.DFR.LEV,B,U2,EUR,4F,KR,DFR,LEV,2025-06-11,2,A
FM.B.U2.EUR.4F.KR.DFR.LEV,B,U2,EUR,4F,KR,DFR,LEV,2026-06-17,2.25,A
`;

describe("SDMX csvdata parser", () => {
  it("extracts period/value pairs from the named columns", () => {
    expect(parseSdmxCsv(HICP_CSV)).toEqual([
      { period: "2026-04", value: "3.5" },
      { period: "2026-05", value: "3.6" },
    ]);
  });

  it("rejects a payload without observation rows or the named columns", () => {
    expect(() => parseSdmxCsv("KEY,TIME_PERIOD,OBS_VALUE\n")).toThrow(/no observation/);
    expect(() => parseSdmxCsv("a,b\n1,2\n")).toThrow(/columns not found/);
  });

  it("rejects malformed periods and values instead of writing garbage", () => {
    const bad = "KEY,TIME_PERIOD,OBS_VALUE\nX,2026-05,not-a-number\n";
    expect(() => parseSdmxCsv(bad)).toThrow(/bad OBS_VALUE/);
  });
});

describe("latestAsFraction", () => {
  it("converts the latest percent observation to a fraction", () => {
    expect(latestAsFraction(parseSdmxCsv(HICP_CSV), "2026-06-11")).toEqual({
      period: "2026-05",
      fraction: "0.036",
    });
  });

  it("ignores a future-dated DFR change until its effective date", () => {
    const obs = parseSdmxCsv(DFR_CSV);
    expect(latestAsFraction(obs, "2026-06-11")).toEqual({
      period: "2025-06-11",
      fraction: "0.02",
    });
    expect(latestAsFraction(obs, "2026-06-17")).toEqual({
      period: "2026-06-17",
      fraction: "0.0225",
    });
  });

  it("returns null when nothing has been published yet", () => {
    expect(latestAsFraction(parseSdmxCsv(HICP_CSV), "2026-03-01")).toBeNull();
  });
});

describe("assumptionFeedDue", () => {
  it("is due when the row is missing or last reviewed before this month", () => {
    expect(assumptionFeedDue(null, "2026-06-11")).toBe(true);
    expect(assumptionFeedDue("2026-05-31", "2026-06-11")).toBe(true);
  });

  it("is not due again within the same month — one feed write per month", () => {
    expect(assumptionFeedDue("2026-06-01", "2026-06-11")).toBe(false);
  });
});

describe("assumption key metadata", () => {
  it("every editable key carries a description and feed keys are editable", () => {
    for (const key of EDITABLE_ASSUMPTION_KEYS) {
      expect(ASSUMPTION_DESCRIPTIONS[key], key).toBeTruthy();
    }
    for (const key of FEED_ASSUMPTION_KEYS) {
      expect(EDITABLE_ASSUMPTION_KEYS).toContain(key);
      // The manage seam range-checks every numeric write, feed ones included.
      expect(ASSUMPTION_RANGES[key], key).toBeDefined();
    }
  });
});
