import { describe, expect, it } from "vitest";
import { validatePicture } from "@/ai/pictureSchema";
import { renderStatementParts } from "@/ai/schema";
import type { AnswerStatement, PictureNarrative } from "@/ai/types";

// The picture's validation delegates to validateAnswer (the Ask rules
// verbatim); the section-level rules — digit-in-heading, fail-closed when
// nothing survives — live here.

const ctx = {
  metrics: [
    {
      id: "picture.liquidSharePct",
      label: "Liquid share",
      value: "3%",
      citations: ["snap_1", "picture.v1"],
    },
    {
      id: "fire.runwayYears",
      label: "Runway",
      value: "31.06 years",
      citations: ["snap_1", "fire.v1"],
    },
  ],
  allowedCitations: ["snap_1", "picture.v1", "fire.v1"],
};

const good = (text: string, label: AnswerStatement["label"] = "calculated") => ({
  label,
  text,
  citations: ["snap_1"],
});

function narrative(sections: PictureNarrative["sections"]): PictureNarrative {
  return { sections };
}

describe("validatePicture", () => {
  it("keeps valid sections and renders nothing it cannot ground", () => {
    const result = validatePicture(
      narrative([
        {
          heading: "The situation",
          statements: [
            good("Runway stands at {{fire.runwayYears}}."),
            { label: "judgment", text: "That is a long time.", citations: [] },
          ],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.narrative.sections).toHaveLength(1);
    expect(result.droppedStatements).toBe(0);
  });

  it("drops statements under the Ask rules: typed digits, unknown tokens, uncited calculated", () => {
    const result = validatePicture(
      narrative([
        {
          heading: "The numbers",
          statements: [
            good("Runway is {{fire.runwayYears}}."),
            good("You have 31 years of runway."), // typed digits
            good("Liquid is {{netWorth.madeUp}}."), // unknown token
            { label: "calculated", text: "Spending is fine.", citations: [] }, // uncited
          ],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.narrative.sections[0].statements).toHaveLength(1);
    expect(result.droppedStatements).toBe(3);
  });

  it("drops a whole section when its heading smuggles a digit", () => {
    const result = validatePicture(
      narrative([
        {
          heading: "31 years of runway",
          statements: [good("Runway is {{fire.runwayYears}}.")],
        },
        {
          heading: "The shape of it",
          statements: [good("Liquid share is {{picture.liquidSharePct}}.")],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.narrative.sections).toHaveLength(1);
    expect(result.narrative.sections[0].heading).toBe("The shape of it");
    expect(result.droppedStatements).toBe(1);
  });

  it("fails closed when nothing survives", () => {
    const result = validatePicture(
      narrative([
        { heading: "Made up", statements: [good("You hold 12 bitcoins.")] },
      ]),
      ctx,
    );
    expect(result).toEqual({ ok: false, reason: "empty-after-validation" });
  });

  it("merges metric provenance into citations via the shared validator", () => {
    const result = validatePicture(
      narrative([
        {
          heading: "Shares",
          statements: [
            { label: "calculated", text: "Liquid is {{picture.liquidSharePct}}.", citations: [] },
          ],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.narrative.sections[0].statements[0].citations).toEqual([
      "snap_1",
      "picture.v1",
    ]);
  });
});

describe("renderStatementParts", () => {
  it("splits prose and metric values, round-tripping the rendered text", () => {
    const text =
      "Liquid is {{picture.liquidSharePct}} of the total; runway {{fire.runwayYears}}.";
    const parts = renderStatementParts(text, ctx.metrics);
    expect(parts).toEqual([
      { kind: "text", value: "Liquid is " },
      { kind: "metric", value: "3%" },
      { kind: "text", value: " of the total; runway " },
      { kind: "metric", value: "31.06 years" },
      { kind: "text", value: "." },
    ]);
  });

  it("leaves unknown tokens as text (defensive — validation rejects them anyway)", () => {
    const parts = renderStatementParts("{{nope}} stays", ctx.metrics);
    expect(parts[0]).toEqual({ kind: "text", value: "{{nope}}" });
  });
});
