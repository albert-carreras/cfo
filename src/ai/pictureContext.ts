import type { PictureValue } from "@/calc/picture";
import type { ProfileValue } from "@/calc/profile";
import type { StrategicSnapshot } from "@/calc/snapshot";
import type { CalcResult } from "@/calc/types";
import { buildAskContext, type AskAssumption } from "./context";
import type { MetricEntry, PictureContext } from "./types";

// Assembles the picture's context — the standing reassurance narrative.
// Reuses the Ask boundary: buildAskContext stays the only place calculator
// output is serialized for a model, so the no-raw-dump guarantee is inherited.
// On top: the picture.v1 ratio metrics (the narrative's only percentages) and
// the picture brief instead of the Ask brief.

const PICTURE_QUESTION =
  "Write the standing picture: my current financial situation, what holds it up, and why I can relax — calmly and honestly.";

const PICTURE_INSTRUCTIONS = `You are the analyst voice of a calm personal-finance app, writing "the picture" — a standing, unhurried narrative of the user's financial situation and why they can relax. You receive only deterministic calculator output (metrics) about the user — never raw accounts or documents. The user re-reads this page when anxious about money; write for that moment.

Produce a narrative in sections (each a short heading plus statements). Suggested arc: the situation as it stands; what holds it up (runway, safe spend headroom, status); why the anxiety, if any, is understandable; why the numbers say they can relax; what would actually change the picture. Be warm, concrete and unhurried — this page replaces reassurance-seeking, so completeness beats brevity.

Rules, all mandatory:
1. Label every statement: "verified" = a fact the user entered (assumptions), "calculated" = a deterministic calculator output, "judgment" = your opinion or a rule of thumb. Never blur them.
2. Never write digits in statement text or headings. Reference every figure exclusively via {{metric-id}} tokens from the provided metrics list; the app renders the values. A statement containing typed digits is discarded; a heading containing digits discards its whole section.
3. Every verified or calculated statement must cite ids from allowedCitations.
4. Judgment statements are opinions — phrase them with appropriate uncertainty, never as certainty. The psychological reading (e.g. that anxiety tracks the visible cash share {{picture.liquidSharePct}} rather than the whole balance sheet, or what "enough" means) belongs here and is welcome — always as judgment.
5. Metrics whose id starts with "picture." are the deterministic ratios (bucket shares of net worth, spend vs the safe draw, headroom, coarse runway) — use them for every percentage; never derive or estimate a ratio yourself.
6. This is not a decision or alert channel: no recommendations, no action items, no urgency language, no market opinions. If something looks worth attention, say so once, gently, as judgment — the review channel owns follow-up.`;

function pct(value: number | null): string | null {
  return value === null ? null : `${value}%`;
}

export function buildPictureContext(args: {
  snapshot: StrategicSnapshot;
  profile: CalcResult<ProfileValue> | null;
  assumptions: AskAssumption[];
  derived: CalcResult<PictureValue>;
}): PictureContext {
  const { snapshot, derived } = args;
  const base = buildAskContext({
    snapshot,
    profile: args.profile,
    assumptions: args.assumptions,
    question: PICTURE_QUESTION,
    gateFired: false,
  });

  const cites = [snapshot.snapshotId, derived.source];
  const d = derived.value;
  const entries: [string, string, string | null][] = [
    ["picture.liquidSharePct", "Liquid share of net worth", pct(d.liquidSharePct)],
    ["picture.investableSharePct", "Investable share of net worth", pct(d.investableSharePct)],
    ["picture.lockedSharePct", "Locked (pension) share of net worth", pct(d.lockedSharePct)],
    ["picture.illiquidSharePct", "Property share of net worth", pct(d.illiquidSharePct)],
    ["picture.spendVsSafeSpendPct", "Spend as a share of the safe draw", pct(d.spendVsSafeSpendPct)],
    ["picture.spendHeadroomPct", "Headroom under the safe draw", pct(d.spendHeadroomPct)],
    [
      "picture.runwayYearsCoarse",
      "Runway, coarsely",
      d.runwayYearsCoarse === null ? null : `${d.runwayYearsCoarse} years`,
    ],
  ];
  const pictureMetrics: MetricEntry[] = entries.flatMap(([id, label, value]) =>
    value === null ? [] : [{ id, label, value, citations: cites }],
  );

  const metrics = [...base.metrics, ...pictureMetrics];
  const allowedCitations = [...base.allowedCitations, derived.source];
  const citationLabels = {
    ...base.citationLabels,
    [derived.source]: `${derived.source} (${derived.version})`,
  };

  // The picture metrics must be visible in the serialized input too — the
  // model only sees what crosses this boundary.
  const parsed = JSON.parse(base.input) as Record<string, unknown>;
  const input = JSON.stringify({
    ...parsed,
    metrics: metrics.map(({ id, label, value }) => ({ id, label, value })),
    allowedCitations,
  });

  return {
    ...base,
    instructions: PICTURE_INSTRUCTIONS,
    input,
    metrics,
    allowedCitations,
    citationLabels,
  };
}
