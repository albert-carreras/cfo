"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addAccount,
  addHolding,
  addProperty,
  disposeAccount,
  disposeHolding,
  disposeProperty,
  setAssumptionAndRecompute,
} from "@/server/manage";
import {
  createPlannedEvent,
  realisePlannedEvent,
} from "@/server/plannedEvents";

// All fact-maintenance intents funnel into the validated /manage seam; each
// is one transaction ending in one strategic-snapshot recompute.

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function opt(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function done() {
  revalidatePath("/");
  revalidatePath("/manage");
  redirect("/manage");
}

export async function submitAddAccount(formData: FormData) {
  await addAccount({
    type: str(formData, "type"),
    name: str(formData, "name"),
    openingCash: str(formData, "openingCash") || "0",
    openingAsOf: str(formData, "openingAsOf"),
  });
  done();
}

export async function submitAddHolding(formData: FormData) {
  const lots: unknown[] = [];
  const lotCount = Number(formData.get("lotCount") ?? 0);
  for (let i = 0; i < lotCount; i++) {
    const buyDate = opt(formData, `lot-${i}-buyDate`);
    if (!buyDate) continue;
    lots.push({
      buyDate,
      quantity: str(formData, `lot-${i}-quantity`),
      price: str(formData, `lot-${i}-price`),
      fees: str(formData, `lot-${i}-fees`) || "0",
      fxRate: str(formData, `lot-${i}-fxRate`) || "1",
    });
  }
  await addHolding({
    accountId: str(formData, "accountId"),
    isin: str(formData, "isin"),
    ticker: opt(formData, "ticker"),
    name: str(formData, "name"),
    currency: str(formData, "currency") || "EUR",
    openingQuantity: str(formData, "openingQuantity") || "0",
    openingAsOf: str(formData, "openingAsOf"),
    acknowledgeUnpriced: formData.get("acknowledgeUnpriced") === "on",
    lots,
  });
  done();
}

function propertyFromForm(formData: FormData, prefix = "") {
  const mortgageBalance = opt(formData, `${prefix}mortgage_balance`);
  return {
    name: str(formData, `${prefix}name`),
    value: str(formData, `${prefix}value`),
    purchasePrice: opt(formData, `${prefix}purchasePrice`),
    ownershipPct: str(formData, `${prefix}ownershipPct`) || "100",
    rentMonthly: str(formData, `${prefix}rentMonthly`) || "0",
    costsMonthly: str(formData, `${prefix}costsMonthly`) || "0",
    isPrimaryResidence: formData.get(`${prefix}isPrimaryResidence`) === "on",
    valuedAt: str(formData, `${prefix}valuedAt`),
    mortgage: mortgageBalance
      ? {
          balance: mortgageBalance,
          rate: opt(formData, `${prefix}mortgage_rate`),
          payment: opt(formData, `${prefix}mortgage_payment`),
        }
      : null,
  };
}

export async function submitAddProperty(formData: FormData) {
  await addProperty(propertyFromForm(formData));
  done();
}

export async function submitDisposeHolding(formData: FormData) {
  await disposeHolding({ holdingId: str(formData, "holdingId") });
  done();
}

export async function submitDisposeAccount(formData: FormData) {
  await disposeAccount({ accountId: str(formData, "accountId") });
  done();
}

export async function submitDisposeProperty(formData: FormData) {
  await disposeProperty({
    propertyId: str(formData, "propertyId"),
    proceedsAccountId: str(formData, "proceedsAccountId"),
    amount: str(formData, "amount"),
    occurredAt: str(formData, "occurredAt"),
    note: opt(formData, "note"),
  });
  done();
}

export async function submitAssumption(formData: FormData) {
  const key = str(formData, "key");
  const isDate = key === "birthDate";
  await setAssumptionAndRecompute({
    key,
    value: isDate ? null : str(formData, "value"),
    dateValue: isDate ? str(formData, "value") : null,
    source: opt(formData, "source") ?? "user (manage)",
  });
  done();
}

export async function submitCreateEvent(formData: FormData) {
  await createPlannedEvent({
    type: str(formData, "type"),
    date: str(formData, "date"),
    amount: str(formData, "amount"),
    probability: str(formData, "probability") || "1",
    includedInBaseCase: formData.get("includedInBaseCase") === "on",
    note: opt(formData, "note"),
  });
  done();
}

export async function submitRealiseEvent(formData: FormData) {
  const type = str(formData, "type");
  const plannedEventId = str(formData, "plannedEventId");
  const base = { type, plannedEventId };

  if (type === "inheritance") {
    await realisePlannedEvent({
      ...base,
      accountId: str(formData, "accountId"),
      amount: str(formData, "amount"),
      occurredAt: str(formData, "occurredAt"),
      note: opt(formData, "note"),
    });
  } else if (type === "pension_withdrawal") {
    await realisePlannedEvent({
      ...base,
      fromAccountId: str(formData, "fromAccountId"),
      toAccountId: str(formData, "toAccountId"),
      amount: str(formData, "amount"),
      occurredAt: str(formData, "occurredAt"),
      note: opt(formData, "note"),
    });
  } else if (type === "house_purchase") {
    await realisePlannedEvent({
      ...base,
      accountId: str(formData, "accountId"),
      amount: str(formData, "amount"),
      occurredAt: str(formData, "occurredAt"),
      property: propertyFromForm(formData, "prop_"),
      note: opt(formData, "note"),
    });
  } else if (type === "property_sale") {
    await realisePlannedEvent({
      ...base,
      propertyId: str(formData, "propertyId"),
      proceedsAccountId: str(formData, "proceedsAccountId"),
      amount: str(formData, "amount"),
      occurredAt: str(formData, "occurredAt"),
      note: opt(formData, "note"),
    });
  } else if (type === "rental_start") {
    await realisePlannedEvent({
      ...base,
      propertyId: str(formData, "propertyId"),
      rentMonthly: str(formData, "rentMonthly"),
    });
  } else {
    await realisePlannedEvent(base);
  }
  done();
}
