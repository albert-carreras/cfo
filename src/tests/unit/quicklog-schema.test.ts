import { describe, expect, it } from "vitest";
import {
  monthlySpendInputSchema,
  movementInputSchema,
  revaluationInputSchema,
  transferInputSchema,
} from "@/server/quicklog";

describe("quick-log schemas", () => {
  it("accepts a well-formed deposit", () => {
    const r = movementInputSchema.safeParse({
      type: "deposit",
      accountId: "acc_bank",
      amount: "5000",
      occurredAt: "2026-06-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("EUR"); // default applied
  });

  it("rejects a buy without a holding and quantity", () => {
    const r = movementInputSchema.safeParse({
      type: "buy",
      accountId: "acc_broker",
      amount: "1254",
      occurredAt: "2026-06-01",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-decimal amount and a malformed date", () => {
    expect(
      movementInputSchema.safeParse({
        type: "deposit",
        accountId: "a",
        amount: "five",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "deposit",
        accountId: "a",
        amount: "5",
        occurredAt: "06/01/2026",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "deposit",
        accountId: "a",
        amount: "5",
        occurredAt: "2026-99-99",
      }).success,
    ).toBe(false);
  });

  it("validates the monthly-spend month format", () => {
    expect(monthlySpendInputSchema.safeParse({ month: "2026-06", amount: "3000" }).success).toBe(true);
    expect(monthlySpendInputSchema.safeParse({ month: "2026-13", amount: "3000" }).success).toBe(false);
    expect(monthlySpendInputSchema.safeParse({ month: "June", amount: "3000" }).success).toBe(false);
  });

  // ---- ----

  it("transfer: accepts two distinct accounts, rejects self-transfers and bad amounts", () => {
    expect(
      transferInputSchema.safeParse({
        fromAccountId: "acc_bank",
        toAccountId: "acc_broker",
        amount: "2000",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(true);
    expect(
      transferInputSchema.safeParse({
        fromAccountId: "acc_bank",
        toAccountId: "acc_bank", // a transfer needs two accounts
        amount: "2000",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      transferInputSchema.safeParse({
        fromAccountId: "acc_bank",
        toAccountId: "acc_broker",
        amount: "0",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
  });

  it("revaluation: accepts a dated statement (zero allowed), rejects malformed input", () => {
    expect(
      revaluationInputSchema.safeParse({
        accountId: "acc_pension",
        value: "86400",
        valuedAt: "2026-05-31",
      }).success,
    ).toBe(true);
    // A statement CAN legitimately read zero (unlike a movement amount).
    expect(
      revaluationInputSchema.safeParse({
        accountId: "acc_pension",
        value: "0",
        valuedAt: "2026-05-31",
      }).success,
    ).toBe(true);
    expect(
      revaluationInputSchema.safeParse({
        accountId: "acc_pension",
        value: "-100",
        valuedAt: "2026-05-31",
      }).success,
    ).toBe(false);
    expect(
      revaluationInputSchema.safeParse({
        accountId: "acc_pension",
        value: "86400",
        valuedAt: "31/05/2026",
      }).success,
    ).toBe(false);
  });

  it("rejects zero/negative values, non-EUR amounts and stray holding fields", () => {
    expect(
      movementInputSchema.safeParse({
        type: "withdraw",
        accountId: "a",
        amount: "-100",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "buy",
        accountId: "a",
        holdingId: "h",
        quantity: "0",
        amount: "100",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "deposit",
        accountId: "a",
        holdingId: "h",
        amount: "100",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "deposit",
        accountId: "a",
        amount: "100",
        currency: "USD",
        occurredAt: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      monthlySpendInputSchema.safeParse({
        month: "2026-06",
        amount: "-3000",
      }).success,
    ).toBe(false);
  });
});
