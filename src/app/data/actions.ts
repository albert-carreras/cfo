"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addAccount,
  addHolding,
  addLoan,
  addOtherAsset,
  addProperty,
  disposeAccount,
  disposeHolding,
  disposeLiability,
  disposeOtherAsset,
  disposeProperty,
  ManageInputError,
  recordDataSnapshot,
  setAssumptionsAndRecompute,
} from "@/server/manage";
import {
  completePlannedEvent,
  createPlannedEvent,
  updatePlannedEvent,
} from "@/server/plannedEvents";
import { PLANNING_INPUT_KEYS } from "@/shared/assumptionKeys";
import { PLAN_AMOUNT_TBD, PLAN_TIMING_UNKNOWN_DATE } from "@/shared/plans";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string) {
  const value = text(form, key);
  return value === "" ? null : value;
}

function done(anchor = "") {
  revalidatePath("/");
  revalidatePath("/data");
  revalidatePath("/history");
  redirect(`/data${anchor}`);
}

// Run a write that can legitimately be rejected (a close precondition, a bad
// value) and, on rejection, bounce back to the workspace with a readable
// message instead of the raw Next error screen. redirect() throws internally,
// so the success path lands in done() and the failure path re-throws its own
// redirect — neither is caught as an input error.
async function guard(run: () => Promise<unknown>, anchor: string) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ManageInputError) {
      redirect(`/data?err=${encodeURIComponent(error.message)}${anchor}`);
    }
    if (error instanceof z.ZodError) {
      redirect(
        `/data?err=${encodeURIComponent(error.issues[0]?.message ?? "invalid input")}${anchor}`,
      );
    }
    throw error;
  }
  done(anchor);
}

export async function saveCurrentSnapshot(formData: FormData) {
  const count = Number(formData.get("observationCount") ?? 0);
  // Only rows the user left confirmed (checkbox on) with a value are written.
  // Unchecking a row skips it, so one balance you cannot confirm today no
  // longer blocks the whole batch.
  const observations = Array.from({ length: count }, (_, index) => ({
    assetType: text(formData, `observation-${index}-type`),
    assetId: text(formData, `observation-${index}-id`),
    value: text(formData, `observation-${index}-value`),
    confirmed: formData.get(`observation-${index}-confirm`) === "on",
  }))
    .filter((row) => row.confirmed && row.value !== "")
    .map(({ assetType, assetId, value }) => ({ assetType, assetId, value }));
  if (observations.length === 0) {
    redirect(
      `/data?err=${encodeURIComponent("Confirm at least one item, or clear its value to skip it.")}#current`,
    );
  }
  await guard(
    () =>
      recordDataSnapshot({
        asOf: text(formData, "asOf"),
        note: optional(formData, "note"),
        observations,
      }),
    "#current",
  );
}

export async function createAccount(formData: FormData) {
  await addAccount({
    type: text(formData, "type"),
    name: text(formData, "name"),
    currency: "EUR",
    openingCash: text(formData, "openingCash") || "0",
    openingAsOf: text(formData, "openingAsOf"),
  });
  done("#structure");
}

export async function createHolding(formData: FormData) {
  await addHolding({
    accountId: text(formData, "accountId"),
    isin: text(formData, "isin"),
    ticker: optional(formData, "ticker"),
    name: text(formData, "name"),
    currency: text(formData, "currency") || "EUR",
    openingQuantity: text(formData, "openingQuantity") || "0",
    openingAsOf: text(formData, "openingAsOf"),
    acknowledgeUnpriced: formData.get("acknowledgeUnpriced") === "on",
    lots: [],
  });
  done("#structure");
}

export async function createProperty(formData: FormData) {
  const mortgageBalance = optional(formData, "mortgageBalance");
  await addProperty({
    name: text(formData, "name"),
    value: text(formData, "value"),
    purchasePrice: optional(formData, "purchasePrice"),
    ownershipPct: text(formData, "ownershipPct") || "100",
    rentMonthly: text(formData, "rentMonthly") || "0",
    costsMonthly: text(formData, "costsMonthly") || "0",
    isPrimaryResidence: formData.get("isPrimaryResidence") === "on",
    valuedAt: text(formData, "valuedAt"),
    mortgage: mortgageBalance
      ? {
          balance: mortgageBalance,
          rate: optional(formData, "mortgageRate"),
          payment: optional(formData, "mortgagePayment"),
        }
      : null,
  });
  done("#structure");
}

export async function createOtherAsset(formData: FormData) {
  await addOtherAsset({
    name: text(formData, "name"),
    category: text(formData, "category") || "other",
    value: text(formData, "value"),
    includeInNetWorth: formData.get("includeInNetWorth") === "on",
    valuedAt: text(formData, "valuedAt"),
    note: optional(formData, "note"),
  });
  done("#structure");
}

export async function createLoan(formData: FormData) {
  await addLoan({
    name: text(formData, "name"),
    balance: text(formData, "balance"),
    rate: optional(formData, "rate"),
    payment: optional(formData, "payment"),
  });
  done("#structure");
}

export async function savePlanningInputs(formData: FormData) {
  // One save, one dated change: collect only the rows the user actually
  // changed (value differs from the submitted current value), then write them
  // in a single transaction with one recompute.
  const inputs = PLANNING_INPUT_KEYS.flatMap((key) => {
    const value = text(formData, `value-${key}`);
    const current = text(formData, `current-${key}`);
    if (value === "" || value === current) return [];
    return [
      {
        key,
        value: key === "birthDate" ? null : value,
        dateValue: key === "birthDate" ? value : null,
        source: "user (data workspace)",
      },
    ];
  });
  if (inputs.length > 0) await setAssumptionsAndRecompute(inputs);
  done("#inputs");
}

// Shared plan fields. The two sentinel checkboxes let the user say "timing
// unknown" / "amount TBD" without remembering the magic date and zero the
// record uses internally.
function planFields(formData: FormData) {
  const timingUnknown = formData.get("timingUnknown") === "on";
  const amountTBD = formData.get("amountTBD") === "on";
  return {
    type: text(formData, "type"),
    date: timingUnknown ? PLAN_TIMING_UNKNOWN_DATE : text(formData, "date"),
    amount: amountTBD ? PLAN_AMOUNT_TBD : text(formData, "amount"),
    note: optional(formData, "note"),
  };
}

export async function createPlan(formData: FormData) {
  await guard(() => createPlannedEvent(planFields(formData)), "#plans");
}

export async function updatePlan(formData: FormData) {
  await guard(
    () =>
      updatePlannedEvent({
        plannedEventId: text(formData, "id"),
        ...planFields(formData),
      }),
    "#plans",
  );
}

export async function completePlan(formData: FormData) {
  await guard(() => completePlannedEvent(text(formData, "id")), "#plans");
}

// --- Soft-close (nothing is deleted; the item leaves the live picture) ------

export async function closeAccount(formData: FormData) {
  await guard(() => disposeAccount({ accountId: text(formData, "id") }), "#dispose");
}

export async function closeHolding(formData: FormData) {
  await guard(() => disposeHolding({ holdingId: text(formData, "id") }), "#dispose");
}

export async function closeLoan(formData: FormData) {
  await guard(() => disposeLiability({ liabilityId: text(formData, "id") }), "#dispose");
}

export async function closeOtherAsset(formData: FormData) {
  await guard(
    () => disposeOtherAsset({ otherAssetId: text(formData, "id") }),
    "#dispose",
  );
}

export async function closeProperty(formData: FormData) {
  await guard(
    () =>
      disposeProperty({
        propertyId: text(formData, "id"),
        proceedsAccountId: text(formData, "proceedsAccountId"),
        amount: text(formData, "amount"),
        occurredAt: text(formData, "occurredAt"),
        note: optional(formData, "note"),
      }),
    "#dispose",
  );
}
