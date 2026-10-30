import { describe, expect, it } from "vitest";
import { buildDigest } from "@/server/digest";
import type { AttentionItem } from "@/calc/attention";

const item = (id: string, level: AttentionItem["level"] = "normal", detail: string | null = null): AttentionItem => ({
  id,
  level,
  title: "Keep about €20,056 aside for 2026 tax on sales",
  detail,
  target: { kind: "values" },
});

describe("monthly digest", () => {
  it("reports the month and what needs you, without euro amounts", () => {
    const n = buildDigest({
      month: "2026-10",
      changePct: 1.234,
      items: [item("tax-2026"), item("stale-values", "normal", "Berga (1 year), Revolut (4 months)")],
    });
    expect(n.title).toBe("CFO · October");
    expect(n.message).toBe(
      "Net worth rose 1.2% in October. Worth a look: tax on this year's sales to keep aside; 2 values to confirm.",
    );
    expect(n.message).not.toContain("€");
    expect(n.priority).toBe("default");
  });

  it("says so when nothing needs you, and escalates a broken price", () => {
    expect(buildDigest({ month: "2026-01", changePct: -0.01, items: [] }).message).toBe(
      "Net worth was flat in January. Nothing needs you.",
    );
    expect(buildDigest({ month: "2026-01", changePct: null, items: [item("prices", "high")] }).priority).toBe("high");
  });
});
