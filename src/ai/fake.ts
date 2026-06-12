import type {
  AskAnswer,
  AskClient,
  PictureClient,
  PictureNarrative,
  QuicklogParseClient,
  ReviewClient,
  ReviewReport,
} from "./types";
import type { QuicklogExtraction } from "./quicklogSchema";

// Deterministic stand-in for tests and keyless development. Builds its answer
// FROM the context it was given (citing the allowed ids, referencing a real
// metric token) so it must pass the same validation as a real provider — the
// fake stays honest.

export function createFakeAskClient(fixed?: AskAnswer): AskClient {
  return {
    async ask(ctx) {
      if (fixed) return { answer: fixed, model: "fake" };
      const metric = ctx.metrics[0];
      const answer: AskAnswer = {
        statements: [
          ...(metric
            ? [
                {
                  label: "calculated" as const,
                  text: `${metric.label} is {{${metric.id}}}.`,
                  citations: metric.citations,
                },
              ]
            : []),
          {
            label: "judgment" as const,
            text: "This is a canned offline answer — no model was called.",
            citations: [],
          },
        ],
        suggestsReview: false,
        requiresManualReview: false,
      };
      return { answer, model: "fake" };
    },
  };
}

// Same idea for the picture: an honest offline narrative built FROM the
// context (a real metric token, the allowed citations) so it must pass
// validatePicture like a real provider would.
export function createFakePictureClient(fixed?: PictureNarrative): PictureClient {
  return {
    async picture(ctx) {
      if (fixed) return { narrative: fixed, model: "fake" };
      const metric = ctx.metrics[0];
      const narrative: PictureNarrative = {
        sections: [
          {
            heading: "The situation",
            statements: [
              ...(metric
                ? [
                    {
                      label: "calculated" as const,
                      text: `${metric.label} stands at {{${metric.id}}}.`,
                      citations: metric.citations,
                    },
                  ]
                : []),
              {
                label: "judgment" as const,
                text: "This is a canned offline narrative — no model was called.",
                citations: [],
              },
            ],
          },
        ],
      };
      return { narrative, model: "fake" };
    },
  };
}

// Same idea for the review: an honest offline report built FROM the
// context (real metric token, allowed citations, a sourced finding) so it must
// pass validateReview like a real provider would.
export function createFakeReviewClient(fixed?: ReviewReport): ReviewClient {
  return {
    async review(ctx) {
      if (fixed) return { report: fixed, model: "fake" };
      const metric = ctx.metrics[0];
      // A revisited decision's measured delta, when one exists — so the fake
      // exercises the section under the same validation as a provider.
      const revisitedMetric = ctx.metrics.find((m) =>
        m.id.startsWith("decision."),
      );
      const report: ReviewReport = {
        digest: [
          ...(metric
            ? [
                {
                  label: "calculated" as const,
                  text: `Checked this month: ${metric.label} is {{${metric.id}}}.`,
                  citations: metric.citations,
                },
              ]
            : []),
          {
            label: "judgment" as const,
            text: "Canned offline review — nothing material changed; no model was called.",
            citations: [],
          },
        ],
        decisionsRevisited: revisitedMetric
          ? [
              {
                label: "judgment" as const,
                text: `Since that decision the change has been {{${revisitedMetric.id}}} — a canned offline read.`,
                citations: [],
              },
            ]
          : [],
        findings: [
          {
            topic: "Offline fixture finding",
            summary: "A canned regulatory note used by tests.",
            status: "in-force",
            effectiveFrom: null,
            sources: ["https://example.invalid/fixture"],
          },
        ],
        taxTables: {
          verdict: "unverified",
          proposedVersion: null,
          notes: "Offline — tables not verified against current law.",
          sources: [],
        },
        recommendation: null,
        suggestsReview: false,
      };
      return { report, model: "fake" };
    },
  };
}

// Deterministic stand-in for the natural-language quick-log parser. The
// default extraction is a fixed deposit transcription so the seam tests can
// run with no network; pass `fixed` to exercise specific shapes.
export function createFakeQuicklogClient(
  fixed?: QuicklogExtraction,
): QuicklogParseClient {
  return {
    async parse() {
      if (fixed) return { extraction: fixed, model: "fake" };
      const extraction: QuicklogExtraction = {
        kind: "clarify",
        movementType: null,
        mentions: [],
        numbers: [],
        date: { rel: null, iso: null, span: null },
        month: null,
        note: null,
        clarifyQuestion: "Offline — what would you like to log?",
      };
      return { extraction, model: "fake" };
    },
  };
}
