import { z } from "zod";
import { MOVEMENT_TYPES } from "@/shared/quicklog";

// The natural-language quick-log extraction contract. The model TRANSCRIBES,
// it never computes and never originates: it returns verbatim spans from the
// user's own text (entity mentions, numbers, a date expression) plus a
// normalized reading of each. Deterministic post-validation proves the
// transcription: every span must appear in the input text, and a normalized
// number must carry exactly the digits of its span. Entity resolution,
// relative dates and all arithmetic (quantity × price) happen server-side —
// the model sees nothing about the user except what they just typed.

export const EXTRACTION_KINDS = [
  "movement",
  "transfer",
  "monthlySpend",
  "pensionStatement",
  "clarify",
] as const;

export const MENTION_ROLES = [
  "account",
  "fromAccount",
  "toAccount",
  "holding",
  "pensionAccount",
] as const;

export const NUMBER_ROLES = [
  "amount", // total EUR moved
  "quantity", // units bought/sold
  "unitPrice", // per-unit price
  "value", // pension statement value
  "spendAmount", // monthly spend figure
] as const;

export const quicklogExtractionSchema = z
  .object({
    kind: z.enum(EXTRACTION_KINDS),
    // Which ledger intent, when kind = "movement".
    movementType: z.enum(MOVEMENT_TYPES).nullable(),
    mentions: z.array(
      z
        .object({
          role: z.enum(MENTION_ROLES),
          mention: z.string().min(1), // verbatim span ("VWCE", "the ING account")
        })
        .strict(),
    ),
    numbers: z.array(
      z
        .object({
          role: z.enum(NUMBER_ROLES),
          span: z.string().min(1), // verbatim ("1.254,30", "10")
          normalized: z.string().min(1), // canonical decimal ("1254.30")
        })
        .strict(),
    ),
    date: z
      .object({
        rel: z.enum(["today", "yesterday"]).nullable(),
        iso: z.string().nullable(), // explicit date, normalized to YYYY-MM-DD
        span: z.string().nullable(), // verbatim date expression
      })
      .strict(),
    month: z.string().nullable(), // YYYY-MM, for monthlySpend
    note: z.string().nullable(),
    clarifyQuestion: z.string().nullable(), // required when kind = "clarify"
  })
  .strict();

export type QuicklogExtraction = z.infer<typeof quicklogExtractionSchema>;

export const quicklogExtractionJsonSchema = z.toJSONSchema(
  quicklogExtractionSchema,
);

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

// The anti-fabrication core: a span the user never typed, or a normalized
// number whose digits differ from its span's, fails the whole extraction —
// the UI then falls back to the manual forms. Deterministic, no model trust.
export function verifyExtractionSpans(
  extraction: QuicklogExtraction,
  text: string,
): { ok: true } | { ok: false; problem: string } {
  const haystack = text.toLowerCase();
  for (const mention of extraction.mentions) {
    if (!haystack.includes(mention.mention.toLowerCase())) {
      return {
        ok: false,
        problem: `mention "${mention.mention}" does not appear in the text`,
      };
    }
  }
  for (const number of extraction.numbers) {
    if (!haystack.includes(number.span.toLowerCase())) {
      return {
        ok: false,
        problem: `number span "${number.span}" does not appear in the text`,
      };
    }
    if (digitsOf(number.normalized) !== digitsOf(number.span)) {
      return {
        ok: false,
        problem: `normalized "${number.normalized}" does not transcribe "${number.span}"`,
      };
    }
  }
  if (extraction.date.span && !haystack.includes(extraction.date.span.toLowerCase())) {
    return {
      ok: false,
      problem: `date span "${extraction.date.span}" does not appear in the text`,
    };
  }
  return { ok: true };
}
