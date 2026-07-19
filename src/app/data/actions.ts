"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addAccount,
  addHolding,
  addLoan,
  addOtherAsset,
  addProperty,
  recordDataSnapshot,
  setAssumptionAndRecompute,
} from "@/server/manage";
import {
  completePlannedEvent,
  createPlannedEvent,
} from "@/server/plannedEvents";

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

export async function saveCurrentSnapshot(formData: FormData) {
  const count = Number(formData.get("observationCount") ?? 0);
  const observations = Array.from({ length: count }, (_, index) => ({
    assetType: text(formData, `observation-${index}-type`),
    assetId: text(formData, `observation-${index}-id`),
    value: text(formData, `observation-${index}-value`),
  }));
  await recordDataSnapshot({
    asOf: text(formData, "asOf"),
    note: optional(formData, "note"),
    observations,
  });
  done("#current");
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

export async function savePlanningInput(formData: FormData) {
  const key = text(formData, "key");
  const value = text(formData, "value");
  await setAssumptionAndRecompute({
    key,
    value: key === "birthDate" ? null : value,
    dateValue: key === "birthDate" ? value : null,
    source: "user (data workspace)",
  });
  done("#inputs");
}

export async function createPlan(formData: FormData) {
  await createPlannedEvent({
    type: text(formData, "type"),
    date: text(formData, "date"),
    amount: text(formData, "amount"),
    probability: text(formData, "probability") || "1",
    includedInBaseCase: formData.get("includedInBaseCase") === "on",
    note: optional(formData, "note"),
  });
  done("#plans");
}

export async function completePlan(formData: FormData) {
  await completePlannedEvent(text(formData, "id"));
  done("#plans");
}
