import type { QuicklogExtraction } from "./quicklogSchema";
import type { QuicklogParseContext } from "./quicklogContext";

// The voice's provider-agnostic contract (principle #13: no provider words
// here). The model receives an AskContext — calculator JSON only, never raw
// accounts — and must return an AskAnswer where every statement carries one of
// the three epistemic labels and cites ids that exist in the context.

export type StatementLabel = "verified" | "calculated" | "judgment";

export type AnswerStatement = {
  label: StatementLabel;
  text: string; // figures only via {{metric-id}} tokens — never typed digits
  citations: string[]; // ids from AskContext.allowedCitations
};

export type AskAnswer = {
  statements: AnswerStatement[];
  suggestsReview: boolean; // "this deserves a review" — a suggestion, never a push
  requiresManualReview: boolean; // model's flag; the server ORs the deterministic gate over it
};

// A deterministic figure the model may reference by token. The value is
// formatted server-side and rendered server-side — the model never produces a
// number about the user (principle #2 / invariant: invented numbers cannot
// reach the screen because raw digits in statements are rejected).
export type MetricEntry = {
  id: string; // e.g. "fire.runwayMonths"
  label: string;
  value: string; // server-formatted ("€412,300", "31 months", "36")
  citations: string[]; // provenance auto-attached to any statement using the token
};

export type AskContext = {
  instructions: string; // the system prompt (labelling, token and citation rules)
  input: string; // the serialized JSON the model sees (the no-raw-dump boundary)
  metrics: MetricEntry[];
  allowedCitations: string[];
  citationLabels: Record<string, string>; // id → human label, for rendering answers
};

export interface AskClient {
  ask(ctx: AskContext): Promise<{ answer: AskAnswer; model: string }>;
}

// --- Review analyst ---

// One web-researched regulatory observation (ES national + Cataluña tax law,
// pension rules, announced reforms). These are about THE LAW, not the user, so
// raw figures are allowed — but a finding without an external source URL is
// dropped by validation (sourced reasoning or nothing).
export type RegulatoryFinding = {
  topic: string; // e.g. "IRPF savings bands"
  summary: string;
  status: "in-force" | "announced"; // announced = forward-looking heads-up
  effectiveFrom: string | null; // YYYY-MM-DD when known
  sources: string[]; // external URLs from the in-review web research
};

// The review's re-verification of the versioned tax tables against current
// law. A bump is a PROPOSAL (a version string), never an applied change.
export type TaxTableVerdict = {
  verdict: "current" | "drifted" | "unverified";
  proposedVersion: string | null; // e.g. "taxES.es-cat.2027.1"
  notes: string;
  sources: string[]; // required for any verdict stronger than "unverified"
};

export type ReviewReport = {
  // The reassurance digest — same rules as Ask statements: labelled, figures
  // only via {{metric}} tokens, verified/calculated must cite.
  digest: AnswerStatement[];
  // The analyst's read on the revisited decisions. The measured
  // deltas themselves are Calculated and pinned on the review row by the
  // deterministic floor; these statements are the voice on top, under exactly
  // the digest's rules (tokens only, labelled, cited). Empty when no decision
  // has been journaled yet — validation forces that.
  decisionsRevisited: AnswerStatement[];
  findings: RegulatoryFinding[];
  taxTables: TaxTableVerdict;
  // Optional Judgment recommendation — journaled as a Decision and
  // manual-review-gated by the server. The review proposes; the human decides.
  recommendation: { text: string; requiresManualReview: boolean } | null;
  suggestsReview: boolean; // may raise "review soon" — never a real-time push
};

// The review reuses the Ask context machinery (metrics, citations, the
// no-raw-dump input) plus the month under review and the deterministic
// recommendation triggers that fired: an empty list means the
// validation will drop any recommendation — no trigger ⇒ no recommendation.
export type ReviewContext = AskContext & {
  month: string;
  triggers: { id: string; label: string }[];
  // The positional ids ("decision.1", …) of the journaled decisions
  // being revisited this month. Empty ⇒ validation empties decisionsRevisited.
  revisited: { id: string }[];
};

export interface ReviewClient {
  review(ctx: ReviewContext): Promise<{ report: ReviewReport; model: string }>;
}

// --- The picture (standing reassurance narrative) ---

// A calm, sectioned essay over the same statement contract as Ask: every
// statement labelled, figures only via {{metric-id}} tokens, verified/
// calculated statements cited. Not a decision channel — no recommendation,
// no manual-review flag, no suggestsReview.
export type PictureSection = {
  heading: string; // prose only — a digit here drops the whole section
  statements: AnswerStatement[];
};

export type PictureNarrative = {
  sections: PictureSection[];
};

// The picture reuses the Ask context machinery unchanged (metrics, citations,
// the no-raw-dump input) — only the instructions and the appended picture.*
// ratio metrics differ.
export type PictureContext = AskContext;

export interface PictureClient {
  picture(
    ctx: PictureContext,
  ): Promise<{ narrative: PictureNarrative; model: string }>;
}

// --- Natural-language quick-log parser ---

// The fourth client. Its context is the tightest boundary of all: the model
// receives only the text the user just typed (see src/ai/quicklogContext.ts)
// and returns a transcription-only extraction (src/ai/quicklogSchema.ts);
// entity resolution, date resolution and arithmetic are server-side.
export interface QuicklogParseClient {
  parse(
    ctx: QuicklogParseContext,
  ): Promise<{ extraction: QuicklogExtraction; model: string }>;
}
