import { describe, expect, it } from "vitest";
import {
  deriveState,
  type DeriveMovement,
  type DeriveRevaluation,
} from "@/calc/derive";

const accounts = [{ id: "a", openingCash: "100", openingAsOf: "2026-01-01" }];
const holdings = [
  { id: "h", accountId: "a", openingQuantity: "10", openingAsOf: "2026-01-01" },
];

const mov = (m: Partial<DeriveMovement> & Pick<DeriveMovement, "id" | "type" | "amount" | "occurredAt">): DeriveMovement => ({
  accountId: "a",
  holdingId: null,
  quantity: null,
  correctsId: null,
  ...m,
});

describe("deriveState", () => {
  it("derives current state = opening baseline + movements since", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [
        mov({ id: "m0", type: "deposit", amount: "999", occurredAt: "2025-12-31" }), // pre-baseline → ignored
        mov({ id: "m1", type: "deposit", amount: "50", occurredAt: "2026-02-01" }),
        mov({ id: "m2", type: "expense", amount: "30", occurredAt: "2026-02-02" }),
        mov({ id: "m3", type: "buy", holdingId: "h", quantity: "5", amount: "20", occurredAt: "2026-02-03" }),
        // correction: m4 supersedes m2 (25 instead of 30)
        mov({ id: "m4", type: "expense", amount: "25", occurredAt: "2026-02-02", correctsId: "m2" }),
        mov({ id: "m5", type: "deposit", amount: "7", occurredAt: "2026-12-01" }), // after asOf → ignored
      ],
      asOf: "2026-06-01",
    });

    // 100 + 50 - 25 (corrected) - 20 (buy) = 105
    expect(result.cashByAccount["a"]).toBe("105.00");
    // 10 + 5 = 15
    expect(result.quantityByHolding["h"]).toBe("15");
  });

  it("excludes superseded, pre-baseline, and future movements from provenance", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [
        mov({ id: "m0", type: "deposit", amount: "999", occurredAt: "2025-12-31" }),
        mov({ id: "m1", type: "deposit", amount: "50", occurredAt: "2026-02-01" }),
        mov({ id: "m2", type: "expense", amount: "30", occurredAt: "2026-02-02" }),
        mov({ id: "m4", type: "expense", amount: "25", occurredAt: "2026-02-02", correctsId: "m2" }),
        mov({ id: "m5", type: "deposit", amount: "7", occurredAt: "2026-12-01" }),
      ],
      asOf: "2026-06-01",
    });

    expect(result.inputs).toContain("m1");
    expect(result.inputs).toContain("m4");
    expect(result.inputs).not.toContain("m0"); // pre-baseline
    expect(result.inputs).not.toContain("m2"); // superseded
    expect(result.inputs).not.toContain("m5"); // future
    // facts always carry provenance
    expect(result.inputs).toContain("a");
    expect(result.inputs).toContain("h");
  });

  it("never mutates the opening baseline when there are no movements", () => {
    const result = deriveState({ accounts, holdings, movements: [], asOf: "2026-06-01" });
    expect(result.cashByAccount["a"]).toBe("100.00");
    expect(result.quantityByHolding["h"]).toBe("10");
  });

  it("does not let a future correction supersede a currently effective row", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [
        mov({ id: "m1", type: "deposit", amount: "50", occurredAt: "2026-02-01" }),
        mov({
          id: "m2",
          type: "deposit",
          amount: "20",
          occurredAt: "2026-12-01",
          correctsId: "m1",
        }),
      ],
      asOf: "2026-06-01",
    });

    expect(result.cashByAccount["a"]).toBe("150.00");
    expect(result.inputs).toContain("m1");
    expect(result.inputs).not.toContain("m2");
  });

  // ---- dated revaluations re-anchor the baseline ----

  const reval = (
    r: Partial<DeriveRevaluation> & Pick<DeriveRevaluation, "id" | "value" | "valuedAt">,
  ): DeriveRevaluation => ({
    accountId: "a",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...r,
  });

  it("re-anchors to the latest statement: value = statement + movements since", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [
        // Before the statement date: already included in the stated value.
        mov({ id: "m1", type: "deposit", amount: "50", occurredAt: "2026-02-01" }),
        // On the statement date: applies (mirrors the >= opening-baseline rule).
        mov({ id: "m2", type: "deposit", amount: "10", occurredAt: "2026-03-31" }),
        mov({ id: "m3", type: "expense", amount: "5", occurredAt: "2026-04-15" }),
      ],
      revaluations: [reval({ id: "r1", value: "500", valuedAt: "2026-03-31" })],
      asOf: "2026-06-01",
    });

    // 500 (statement) + 10 - 5; the pre-statement deposit is absorbed.
    expect(result.cashByAccount["a"]).toBe("505.00");
    expect(result.cashInputsByAccount["a"]).toContain("r1");
    expect(result.cashInputsByAccount["a"]).toContain("m2");
    expect(result.cashInputsByAccount["a"]).not.toContain("m1");
    expect(result.inputs).toContain("r1");
  });

  it("the newest effective statement wins; future and pre-baseline ones are ignored", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [],
      revaluations: [
        reval({ id: "r_old", value: "300", valuedAt: "2026-02-01" }),
        reval({ id: "r_new", value: "400", valuedAt: "2026-04-01" }),
        reval({ id: "r_future", value: "999", valuedAt: "2026-12-01" }), // after asOf
        reval({ id: "r_pre", value: "1", valuedAt: "2025-06-01" }), // before opening
      ],
      asOf: "2026-06-01",
    });

    expect(result.cashByAccount["a"]).toBe("400.00");
    expect(result.cashInputsByAccount["a"]).toEqual(["a", "r_new"]);
  });

  it("a same-day re-statement supersedes by createdAt (append-only correction path)", () => {
    const result = deriveState({
      accounts,
      holdings,
      movements: [],
      revaluations: [
        reval({ id: "r1", value: "300", valuedAt: "2026-04-01", createdAt: "2026-04-02T09:00:00.000Z" }),
        reval({ id: "r2", value: "310", valuedAt: "2026-04-01", createdAt: "2026-04-03T09:00:00.000Z" }),
      ],
      asOf: "2026-06-01",
    });

    expect(result.cashByAccount["a"]).toBe("310.00");
    expect(result.cashInputsByAccount["a"]).toContain("r2");
    expect(result.cashInputsByAccount["a"]).not.toContain("r1");
  });

  it("applies account and holding opening baselines independently", () => {
    const result = deriveState({
      accounts,
      holdings: [
        { id: "h", accountId: "a", openingQuantity: "10", openingAsOf: "2026-06-01" },
      ],
      movements: [
        mov({
          id: "m",
          type: "buy",
          holdingId: "h",
          quantity: "5",
          amount: "20",
          occurredAt: "2026-03-01",
        }),
      ],
      asOf: "2026-06-09",
    });

    expect(result.cashByAccount["a"]).toBe("80.00");
    expect(result.quantityByHolding["h"]).toBe("10");
    expect(result.cashInputsByAccount["a"]).toContain("m");
    expect(result.quantityInputsByHolding["h"]).not.toContain("m");
  });
});
