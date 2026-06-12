import { z } from "zod";
import { validateAnswer } from "./schema";
import type { AskContext, PictureNarrative } from "./types";

// The picture's structured-output contract and its deterministic enforcement.
// Statement validation DELEGATES to validateAnswer — the Ask rules verbatim
// (unknown token ⇒ dropped, typed digits ⇒ dropped, uncited verified/
// calculated ⇒ dropped) — so there is exactly one number-safety implementation.
// The one extra rule lives here: headings cannot carry tokens, so a digit in a
// heading is a smuggled number and drops the whole section.

export const pictureNarrativeSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1),
            statements: z
              .array(
                z
                  .object({
                    label: z.enum(["verified", "calculated", "judgment"]),
                    text: z.string().min(1),
                    citations: z.array(z.string()),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const pictureNarrativeJsonSchema = z.toJSONSchema(pictureNarrativeSchema);

export type ValidatedPicture =
  | { ok: true; narrative: PictureNarrative; droppedStatements: number }
  | { ok: false; reason: "empty-after-validation" };

export function validatePicture(
  narrative: PictureNarrative,
  ctx: Pick<AskContext, "metrics" | "allowedCitations">,
): ValidatedPicture {
  let dropped = 0;

  const sections = narrative.sections.flatMap((section) => {
    if (/\d/.test(section.heading)) {
      dropped += section.statements.length;
      return [];
    }
    const validated = validateAnswer(
      {
        statements: section.statements,
        suggestsReview: false,
        requiresManualReview: false,
      },
      ctx,
    );
    if (!validated.ok) {
      dropped += section.statements.length;
      return [];
    }
    dropped += validated.droppedStatements;
    return [{ heading: section.heading, statements: validated.answer.statements }];
  });

  if (sections.length === 0) return { ok: false, reason: "empty-after-validation" };
  return { ok: true, narrative: { sections }, droppedStatements: dropped };
}
