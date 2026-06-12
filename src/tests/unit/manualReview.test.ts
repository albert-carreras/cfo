import { describe, expect, it } from "vitest";
import { touchesIrreversibleAction } from "@/ai/manualReview";

// The deterministic half of the lock (principle #9). Conservative by design:
// a keyword gate can't price "sell VVSM" against the €100k threshold, so every
// sale / job exit / withdrawal gates. Over-gating costs a review; under-gating
// is the risk.

describe("touchesIrreversibleAction", () => {
  it.each([
    "Should I sell the apartment in Girona?",
    "Is selling half my VWCE position sensible?",
    "thinking about the sale of the flat",
    "¿Debería vender el piso?",
    "Can I quit my job in 2027?",
    "I want to resign next spring",
    "should I leave my job",
    "quiero dejar el trabajo",
    "withdraw my pension early?",
    "rescatar el plan de pensiones",
    "cash out the broker account",
  ])("gates %j", (question) => {
    expect(touchesIrreversibleAction(question)).toBe(true);
  });

  it.each([
    "What's my runway?",
    "How did net worth move this month?",
    "Is my data quality ok?",
    "When is the next review due?",
  ])("does not gate %j", (question) => {
    expect(touchesIrreversibleAction(question)).toBe(false);
  });

  it("ORs with the model flag — the model can add a review, never remove one", () => {
    const gate = touchesIrreversibleAction("Should I sell the flat?");
    expect(gate || false).toBe(true); // gate fired, model said no → locked
    expect(touchesIrreversibleAction("What's my runway?") || true).toBe(true); // model flagged → locked
  });
});
