import { describe, expect, it } from "vitest";
import {
  addAccountSchema,
  addHoldingSchema,
  addPropertySchema,
  canDisposeAccount,
  canDisposeHolding,
  disposePropertySchema,
} from "@/server/manage";
import {
  plannedEventInputSchema,
  realiseInputSchema,
  updatePlannedEventSchema,
} from "@/server/plannedEvents";

describe("dispose preconditions", () => {
  it("a holding may close only at exactly zero quantity", () => {
    expect(canDisposeHolding("0")).toBe(true);
    expect(canDisposeHolding("0.0001")).toBe(false);
    expect(canDisposeHolding("10")).toBe(false);
  });

  it("an account may close only with zero cash and no live holdings", () => {
    expect(canDisposeAccount("0", 0).ok).toBe(true);
    const cash = canDisposeAccount("1500.00", 0);
    expect(cash.ok).toBe(false);
    expect(cash.reason).toContain("1500.00");
    const holdings = canDisposeAccount("0", 2);
    expect(holdings.ok).toBe(false);
    expect(holdings.reason).toContain("2 live holding");
  });
});

describe("add-later fact schemas", () => {
  it("addAccount requires an explicit opening date", () => {
    expect(
      addAccountSchema.safeParse({
        type: "bank",
        name: "New bank",
        openingCash: "500",
        openingAsOf: "2026-06-10",
      }).success,
    ).toBe(true);
    expect(
      addAccountSchema.safeParse({
        type: "bank",
        name: "New bank",
        openingCash: "500",
      }).success,
    ).toBe(false);
  });

  it("addHolding accepts lots and keeps EUR default currency", () => {
    const r = addHoldingSchema.safeParse({
      accountId: "acc_broker",
      isin: "IE00B4L5Y983",
      ticker: "IWDA.AS",
      name: "iShares Core MSCI World",
      openingQuantity: "100",
      openingAsOf: "2026-06-01",
      lots: [
        { buyDate: "2025-01-01", quantity: "100", price: "80", fees: "2" },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.currency).toBe("EUR");
      expect(r.data.lots[0].fxRate).toBe("1");
    }
  });

  it("addProperty carries an optional mortgage", () => {
    const r = addPropertySchema.safeParse({
      name: "New flat",
      value: "250000",
      valuedAt: "2026-06-01",
      mortgage: { balance: "180000", rate: "0.025" },
    });
    expect(r.success).toBe(true);
    expect(
      addPropertySchema.safeParse({
        name: "New flat",
        value: "250000",
        valuedAt: "2026-06-01",
        mortgage: { rate: "0.025" },
      }).success,
    ).toBe(false); // a mortgage needs a balance
  });

  it("disposeProperty requires proceeds destination, amount and date", () => {
    expect(
      disposePropertySchema.safeParse({
        propertyId: "prop_a",
        proceedsAccountId: "acc_bank",
        amount: "300000",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(true);
    expect(
      disposePropertySchema.safeParse({
        propertyId: "prop_a",
        proceedsAccountId: "acc_bank",
        amount: "0",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(false);
  });
});

describe("planned events", () => {
  it("forecasts may be dated in the future", () => {
    expect(
      plannedEventInputSchema.safeParse({
        type: "inheritance",
        date: "2032-01-01",
        amount: "100000",
        probability: "0.5",
      }).success,
    ).toBe(true);
  });

  it("update requires the event id", () => {
    expect(
      updatePlannedEventSchema.safeParse({
        type: "inheritance",
        date: "2032-01-01",
        amount: "100000",
      }).success,
    ).toBe(false);
  });

  it("realisation is type-specific — each kind states what it needs", () => {
    // Money kinds need account + amount + date.
    expect(
      realiseInputSchema.safeParse({
        type: "inheritance",
        plannedEventId: "ev1",
        accountId: "acc_bank",
        amount: "90000",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(true);
    expect(
      realiseInputSchema.safeParse({
        type: "inheritance",
        plannedEventId: "ev1",
      }).success,
    ).toBe(false);

    // pension_withdrawal is a two-leg transfer: it needs BOTH accounts.
    expect(
      realiseInputSchema.safeParse({
        type: "pension_withdrawal",
        plannedEventId: "ev6",
        fromAccountId: "acc_pension",
        toAccountId: "acc_bank",
        amount: "12000",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(true);
    expect(
      realiseInputSchema.safeParse({
        type: "pension_withdrawal",
        plannedEventId: "ev6",
        accountId: "acc_bank", // the old one-sided shape no longer parses
        amount: "12000",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(false);

    // job_exit needs nothing — no ledger row is written.
    expect(
      realiseInputSchema.safeParse({ type: "job_exit", plannedEventId: "ev2" })
        .success,
    ).toBe(true);

    // house_purchase carries the full property fact.
    expect(
      realiseInputSchema.safeParse({
        type: "house_purchase",
        plannedEventId: "ev3",
        accountId: "acc_bank",
        amount: "60000",
        occurredAt: "2026-06-10",
        property: {
          name: "New home",
          value: "300000",
          valuedAt: "2026-06-10",
          mortgage: { balance: "240000" },
        },
      }).success,
    ).toBe(true);

    // rental_start is a slow-fact edit, not a movement.
    expect(
      realiseInputSchema.safeParse({
        type: "rental_start",
        plannedEventId: "ev4",
        propertyId: "prop_a",
        rentMonthly: "950",
      }).success,
    ).toBe(true);

    // property_sale routes into the disposal flow.
    expect(
      realiseInputSchema.safeParse({
        type: "property_sale",
        plannedEventId: "ev5",
        propertyId: "prop_a",
        proceedsAccountId: "acc_bank",
        amount: "310000",
        occurredAt: "2026-06-10",
      }).success,
    ).toBe(true);
  });
});
