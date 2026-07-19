import { describe, expect, it, vi } from "vitest";
import {
  buildHealthCheckRequestBody,
  runHealthCheckModel,
  validateHealthCheck,
  type HealthCheckSummary,
} from "@/ai/check";

const summary: HealthCheckSummary = {
  asOf: "2026-07-19",
  deterministicVerdict: "ok",
  metrics: {
    netWorthEUR: "2500000.00",
    liquidEUR: "82000.00",
    investableEUR: "745000.00",
    lockedEUR: "260000.00",
    propertyEquityEUR: "1450000.00",
    debtEUR: "0.00",
    monthlySpendEUR: "2200.00",
    safeMonthlySpendEUR: "2412.00",
    runwayYears: 31.3,
    basePlanHolds: true,
    conservativePlanHolds: false,
  },
  data: { score: "Good", missing: [], flags: [] },
  plans: [],
  concentrations: [],
};

describe("monthly health-check voice", () => {
  it("uses the smart model with no storage or tools", () => {
    const body = buildHealthCheckRequestBody(summary);
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("tools");
    expect(body.text.format.strict).toBe(true);
  });

  it("drops model prose that tries to originate figures", () => {
    expect(validateHealthCheck({
      verdict: "watch",
      headline: "Cash fell by 20 percent",
      observations: ["Liquidity is worth watching.", "You have 10 years left."],
    })).toEqual({
      verdict: "watch",
      headline: "The latest financial check is complete.",
      observations: ["Liquidity is worth watching."],
    });
  });

  it("parses the structured Responses API output", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              verdict: "ok",
              headline: "The current position looks broadly sound.",
              observations: ["One future plan still needs funding detail."],
            }),
          }],
        }],
      }),
    }));

    const result = await runHealthCheckModel({
      apiKey: "test-key",
      summary,
      fetchImpl,
    });

    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.report.verdict).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
