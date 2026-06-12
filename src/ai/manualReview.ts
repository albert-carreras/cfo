// The deterministic half of the manual-review lock (principle #9). A keyword
// gate cannot know whether "sell VVSM" is above €100k, so it gates EVERY
// property/security sale, job exit and withdrawal-shaped question —
// over-gating is safe (an extra review), under-gating is the risk. The server
// ORs this with the model's own flag: the model can add a review, never argue
// one away. Versioned via VERSIONS.ask.

export const MANUAL_REVIEW_SENTENCE =
  "This recommendation requires manual review before becoming an action.";

const IRREVERSIBLE_PATTERNS: RegExp[] = [
  // sell anything (EN + ES/CA stems)
  /\bsell\w*\b/i,
  /\bsale\b/i,
  /\bsold\b/i,
  /\bvend\w+/i,
  /\bventa\b/i,
  // quit / leave the job
  /\bquit\w*\b/i,
  /\bresign\w*\b/i,
  /\bleave\s+(my\s+|the\s+)?(job|work)\b/i,
  /\bdej\w+\s+(el\s+|mi\s+)?trabajo\b/i,
  // pension / cash withdrawal
  /\bwithdraw\w*\b/i,
  /\brescat\w+/i,
  /\bcash\s+out\b/i,
];

export function touchesIrreversibleAction(question: string): boolean {
  return IRREVERSIBLE_PATTERNS.some((pattern) => pattern.test(question));
}
