import { describe, expect, it } from "vitest";
import {
  askAnswerJsonSchema,
  askAnswerSchema,
  renderStatementText,
  validateAnswer,
} from "@/ai/schema";
import type { AskAnswer, MetricEntry } from "@/ai/types";

const metrics: MetricEntry[] = [
  {
    id: "fire.runwayMonths",
    label: "Runway",
    value: "112 months",
    citations: ["snap_1", "fire.v1"],
  },
];
const ctx = { metrics, allowedCitations: ["snap_1", "fire.v1", "assum_swr"] };

const answer = (statements: AskAnswer["statements"]): AskAnswer => ({
  statements,
  suggestsReview: false,
  requiresManualReview: false,
});

describe("askAnswerSchema", () => {
  it("accepts a well-formed answer", () => {
    const result = askAnswerSchema.safeParse(
      answer([{ label: "calculated", text: "Runway is {{fire.runwayMonths}}.", citations: ["fire.v1"] }]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects unknown labels, empty statements and extra properties", () => {
    expect(
      askAnswerSchema.safeParse(
        answer([{ label: "fact" as never, text: "x", citations: [] }]),
      ).success,
    ).toBe(false);
    expect(askAnswerSchema.safeParse(answer([])).success).toBe(false);
    expect(
      askAnswerSchema.safeParse({ ...answer([{ label: "judgment", text: "x", citations: [] }]), extra: 1 }).success,
    ).toBe(false);
  });

  it("exports a strict JSON schema usable for structured outputs", () => {
    const json = JSON.stringify(askAnswerJsonSchema);
    expect(json).toContain('"additionalProperties":false');
    expect(json).not.toContain('"additionalProperties":true');
  });
});

describe("validateAnswer (the LLM never originates a number)", () => {
  it("keeps a tokenised statement and merges the metric's provenance", () => {
    const result = validateAnswer(
      answer([{ label: "calculated", text: "Runway is {{fire.runwayMonths}}.", citations: [] }]),
      ctx,
    );
    expect(result).toMatchObject({ ok: true, droppedStatements: 0 });
    if (result.ok) {
      expect(result.answer.statements[0].citations.sort()).toEqual(["fire.v1", "snap_1"]);
    }
  });

  it("drops statements with raw digits — fabricated figures never reach the screen", () => {
    const result = validateAnswer(
      answer([
        { label: "calculated", text: "Your runway is 99 months.", citations: ["fire.v1"] },
        { label: "judgment", text: "A 4% rule is common.", citations: [] },
        { label: "judgment", text: "Your runway looks comfortable.", citations: [] },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ ok: true, droppedStatements: 2 });
    if (result.ok) {
      expect(result.answer.statements).toHaveLength(1);
      expect(result.answer.statements[0].text).toContain("comfortable");
    }
  });

  it("drops statements referencing unknown metric tokens", () => {
    const result = validateAnswer(
      answer([
        { label: "calculated", text: "Net worth is {{netWorth.totalEUR}}.", citations: ["snap_1"] },
        { label: "judgment", text: "Fine overall.", citations: [] },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ ok: true, droppedStatements: 1 });
  });

  it("strips unknown citations and drops uncited calculated claims (never relabels)", () => {
    const result = validateAnswer(
      answer([
        { label: "calculated", text: "Runway is fine.", citations: ["made-up-id"] },
        { label: "verified", text: "Your withdrawal-rate assumption.", citations: ["assum_swr", "bogus"] },
      ]),
      ctx,
    );
    expect(result).toMatchObject({ ok: true, droppedStatements: 1 });
    if (result.ok) {
      expect(result.answer.statements).toHaveLength(1);
      expect(result.answer.statements[0]).toMatchObject({
        label: "verified",
        citations: ["assum_swr"],
      });
    }
  });

  it("fails closed when nothing survives", () => {
    const result = validateAnswer(
      answer([{ label: "calculated", text: "Exactly 1234 EUR.", citations: ["fire.v1"] }]),
      ctx,
    );
    expect(result).toEqual({ ok: false, reason: "empty-after-validation" });
  });
});

describe("renderStatementText", () => {
  it("renders tokens to the server-formatted values", () => {
    expect(renderStatementText("Runway is {{fire.runwayMonths}}.", metrics)).toBe(
      "Runway is 112 months.",
    );
  });
});
