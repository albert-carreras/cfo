import { describe, expect, it } from "vitest";
import { getAskClient } from "@/ai";
import { createFakeAskClient } from "@/ai/fake";
import { validateAnswer } from "@/ai/schema";
import type { AskAnswer, AskContext } from "@/ai/types";
import { computeSnapshot } from "@/calc/snapshot";
import { askQuestion, type AskDeps } from "@/server/ask";
import { facts, fixture, FIXTURE_AS_OF } from "../fixtures";

// The orchestration seam, end to end with no DB and no network: every
// dependency injected, the fake client behind the real factory types.

const snapshot = computeSnapshot({
  snapshotId: "snap_test",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

type Saved = Parameters<AskDeps["saveDecision"]>[0];

function makeDeps(overrides: Partial<AskDeps> = {}) {
  const saved: Saved[] = [];
  const deps: AskDeps = {
    apiKey: () => "sk-test",
    latestSnapshotRow: async () => ({ id: "snap_test", result: snapshot }),
    assumptionRows: async () =>
      fixture.assumptions.map((a) => ({
        id: a.id,
        key: a.key,
        value: a.value,
        dateValue: a.dateValue ?? null,
        source: a.source,
      })),
    clientFor: () => ({ ok: true, client: createFakeAskClient() }),
    saveDecision: async (row) => {
      saved.push(row);
      return { id: "dec_1" };
    },
    today: () => "2026-06-10",
    ...overrides,
  };
  return { deps, saved };
}

describe("askQuestion", () => {
  it("answers, validates and journals a plain question", async () => {
    const { deps, saved } = makeDeps();
    const result = await askQuestion("How is my runway looking?", deps);

    expect(result).toEqual({ ok: true, decisionId: "dec_1", droppedStatements: 0 });
    expect(saved).toHaveLength(1);
    const decision = saved[0];
    expect(decision.snapshotId).toBe("snap_test");
    expect(decision.requiresManualReview).toBe(false);
    expect(decision.model).toBe("fake");
    const ctx = decision.context as AskContext;
    expect(ctx.input).toContain('"ageYears":37'); // birthDate flowed into the profile
    expect((decision.answer as AskAnswer).statements.length).toBeGreaterThan(0);
  });

  it("the fake client's answer passes the same validation as a real provider", async () => {
    const { deps, saved } = makeDeps();
    await askQuestion("How is my runway looking?", deps);
    const ctx = saved[0].context as AskContext;
    const replay = await createFakeAskClient().ask(ctx);
    expect(validateAnswer(replay.answer, ctx)).toMatchObject({ ok: true });
  });

  it("locks manual review deterministically — the model's 'false' cannot unlock it", async () => {
    const { deps, saved } = makeDeps(); // fake answers requiresManualReview: false
    const result = await askQuestion("Should I sell the apartment?", deps);
    expect(result.ok).toBe(true);
    expect(saved[0].requiresManualReview).toBe(true);
    expect((saved[0].answer as AskAnswer).requiresManualReview).toBe(true);
  });

  it("keeps the model's manual-review flag when the gate did not fire", async () => {
    const flagged = createFakeAskClient({
      statements: [{ label: "judgment", text: "Tread carefully.", citations: [] }],
      suggestsReview: false,
      requiresManualReview: true,
    });
    const { deps, saved } = makeDeps({ clientFor: () => ({ ok: true, client: flagged }) });
    await askQuestion("How is my runway looking?", deps);
    expect(saved[0].requiresManualReview).toBe(true);
  });

  it("a missing key blocks before any snapshot/context/provider work", async () => {
    let touched = false;
    const { deps, saved } = makeDeps({
      apiKey: () => undefined,
      clientFor: getAskClient, // the real factory: the key gate resolves first
      latestSnapshotRow: async () => {
        touched = true;
        return { id: "snap_test", result: snapshot };
      },
    });
    const result = await askQuestion("How is my runway looking?", deps);
    expect(result).toEqual({ ok: false, reason: "no-key" });
    expect(touched).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it.each([
    ["", "invalid-question"],
    ["hi", "invalid-question"],
    ["x".repeat(501), "invalid-question"],
    [null, "invalid-question"],
  ])("rejects invalid question %j", async (question, reason) => {
    const { deps, saved } = makeDeps();
    expect(await askQuestion(question, deps)).toEqual({ ok: false, reason });
    expect(saved).toHaveLength(0);
  });

  it("reports no-snapshot when none is persisted", async () => {
    const { deps } = makeDeps({ latestSnapshotRow: async () => null });
    expect(await askQuestion("How is my runway looking?", deps)).toEqual({
      ok: false,
      reason: "no-snapshot",
    });
  });

  it("turns provider throws into provider-error without journaling", async () => {
    const { deps, saved } = makeDeps({
      clientFor: () => ({
        ok: true,
        client: {
          ask: async () => {
            throw new Error("boom");
          },
        },
      }),
    });
    expect(await askQuestion("How is my runway looking?", deps)).toEqual({
      ok: false,
      reason: "provider-error",
    });
    expect(saved).toHaveLength(0);
  });

  it("rejects an answer whose every statement fails validation", async () => {
    const fabricator = createFakeAskClient({
      statements: [
        { label: "calculated", text: "Your runway is 999 months.", citations: [] },
      ],
      suggestsReview: false,
      requiresManualReview: false,
    });
    const { deps, saved } = makeDeps({
      clientFor: () => ({ ok: true, client: fabricator }),
    });
    expect(await askQuestion("How is my runway looking?", deps)).toEqual({
      ok: false,
      reason: "invalid-answer",
    });
    expect(saved).toHaveLength(0);
  });
});
