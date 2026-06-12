import { z } from "zod";
import { getAskClient, type AskClientResult } from "@/ai";
import { buildAskContext, type AskAssumption } from "@/ai/context";
import { touchesIrreversibleAction } from "@/ai/manualReview";
import { validateAnswer } from "@/ai/schema";
import { profile } from "@/calc/profile";
import { db } from "./db";
import { assumptions } from "./db/schema";
import { saveDecision } from "./decisions";
import { getServerEnv } from "./env";
import { latestStrategicSnapshot, storedSnapshotResult } from "./snapshots";

// The Ask orchestration seam — the only place the voice touches the
// brain. Every dependency is injectable so the whole flow is unit-testable
// with no DB and no network; the clock lives here, at the boundary, never
// inside a calculator. Failures come back as reasons, never as throws to the
// UI.

const questionSchema = z.string().trim().min(3).max(500);

export type AskFailure =
  | "invalid-question"
  | "no-key"
  | "no-snapshot"
  | "provider-error"
  | "invalid-answer";

export type AskResult =
  | { ok: true; decisionId: string; droppedStatements: number }
  | { ok: false; reason: AskFailure };

export type AskDeps = {
  apiKey: () => string | undefined;
  latestSnapshotRow: () => Promise<{ id: string; result: unknown } | null>;
  assumptionRows: () => Promise<AskAssumption[]>;
  clientFor: (opts: { apiKey: string | undefined }) => AskClientResult;
  saveDecision: (row: {
    question: string;
    answer: unknown;
    context: unknown;
    assumptions: unknown;
    snapshotId: string;
    requiresManualReview: boolean;
    model: string;
  }) => Promise<{ id: string }>;
  today: () => string;
};

async function loadAssumptionRows(): Promise<AskAssumption[]> {
  const rows = await db.select().from(assumptions);
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    value: row.value,
    dateValue: row.dateValue,
    source: row.source,
  }));
}

const defaultDeps: AskDeps = {
  apiKey: () => getServerEnv().OPENAI_API_KEY,
  latestSnapshotRow: () => latestStrategicSnapshot(),
  assumptionRows: loadAssumptionRows,
  clientFor: getAskClient,
  saveDecision: (row) => saveDecision(row),
  today: () => new Date().toISOString().slice(0, 10),
};

export async function askQuestion(
  rawQuestion: unknown,
  deps: AskDeps = defaultDeps,
): Promise<AskResult> {
  const parsed = questionSchema.safeParse(rawQuestion);
  if (!parsed.success) return { ok: false, reason: "invalid-question" };
  const question = parsed.data;

  // A missing key resolves BEFORE any context is assembled or any provider
  // module could run (invariant #6).
  const clientResult = deps.clientFor({ apiKey: deps.apiKey() });
  if (!clientResult.ok) return { ok: false, reason: clientResult.reason };

  const row = await deps.latestSnapshotRow();
  if (!row) return { ok: false, reason: "no-snapshot" };
  const snapshot = storedSnapshotResult(row);

  const assumptionRows = await deps.assumptionRows();
  const birth = assumptionRows.find(
    (a) => a.key === "birthDate" && a.dateValue !== null,
  );
  const prof = profile({
    snapshotId: snapshot.snapshotId,
    asOf: deps.today(),
    birthDate: birth ? { id: birth.id, date: birth.dateValue as string } : null,
  });

  // The deterministic half of the manual-review lock — ORed with the model's
  // own flag below, so the model can add a review but never argue one away.
  const gateFired = touchesIrreversibleAction(question);

  const ctx = buildAskContext({
    snapshot,
    profile: prof,
    assumptions: assumptionRows,
    question,
    gateFired,
  });

  let outcome;
  try {
    outcome = await clientResult.client.ask(ctx);
  } catch {
    return { ok: false, reason: "provider-error" };
  }

  const validated = validateAnswer(outcome.answer, ctx);
  if (!validated.ok) return { ok: false, reason: "invalid-answer" };

  const requiresManualReview =
    gateFired || validated.answer.requiresManualReview;

  const saved = await deps.saveDecision({
    question,
    answer: { ...validated.answer, requiresManualReview },
    context: ctx,
    assumptions: assumptionRows,
    snapshotId: row.id,
    requiresManualReview,
    model: outcome.model,
  });

  return {
    ok: true,
    decisionId: saved.id,
    droppedStatements: validated.droppedStatements,
  };
}
