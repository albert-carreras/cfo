"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addAccount,
  addHolding,
  addLiability,
  addLot,
  addOtherAsset,
  addProperty,
  completePlan,
  editAccount,
  editHolding,
  editLiability,
  editOtherAsset,
  editProperty,
  savePlan,
  savePlanningInputs,
} from "@/server/items";
import {
  buyInvestment,
  closeAccount,
  closeLiability,
  closeOtherAsset,
  markTaxPaid,
  moveMoney,
  removeHolding,
  sellInvestment,
  sellProperty,
  setSaleCostBasis,
  setValues,
  undoTaxPaid,
  voidSale,
} from "@/server/record";
import { recordTodaySnapshot, refreshPrice } from "@/server/feed/update";
import { RecordError } from "@/server/write";
import { PLANNING_INPUTS } from "@/shared/inputs";
import { PLAN_AMOUNT_TBD, PLAN_TIMING_UNKNOWN_DATE } from "@/shared/plans";
import { normalizeNumberInput } from "@/shared/validation";
import { dec } from "@/calc/money";

// Form → flow adapters. Each returns { error } for a rejection the person can
// fix (the form keeps what they typed) and redirects on success.

export type ActionResult = { error: string } | undefined;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string) {
  const value = text(form, key);
  return value === "" ? null : value;
}

function money(form: FormData, key: string) {
  const value = normalizeNumberInput(text(form, key), "money");
  return value === "" ? null : value;
}

function units(form: FormData, key: string) {
  const value = normalizeNumberInput(text(form, key), "units");
  return value === "" ? null : value;
}

function checked(form: FormData, key: string) {
  return form.get(key) === "on";
}

// Rate fields accept "3.5%" or "0.035".
function rate(form: FormData, key: string) {
  const raw = text(form, key);
  if (raw === "") return null;
  if (raw.endsWith("%")) {
    const n = normalizeNumberInput(raw.slice(0, -1), "units");
    return /^\d+(\.\d+)?$/.test(n) ? dec(n).dividedBy(100).toString() : raw;
  }
  return normalizeNumberInput(raw, "units");
}

async function run(
  work: () => Promise<unknown>,
  done: string,
  message?: string,
): Promise<ActionResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const field = issue?.path.at(-1);
      return { error: `${issue?.message ?? "Something isn't right"}${field ? ` (${String(field)})` : ""}` };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(message ? `${done}${done.includes("?") ? "&" : "?"}done=${encodeURIComponent(message)}` : done);
}

// A freshly added or re-tickered investment is priced at once instead of
// tomorrow morning. Best effort: a miss shows on the attention list.
async function priceNow(holding: { isin: string; ticker: string | null } | null | undefined) {
  if (!holding) return;
  const result = await refreshPrice(holding);
  if (result.ok) await recordTodaySnapshot();
}

// --- Things that happened ----------------------------------------------------

export async function setValuesAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const values = [...form.keys()]
    .filter((key) => key.startsWith("v:"))
    .flatMap((key) => {
      const [, assetType, assetId] = key.split(":");
      const value = normalizeNumberInput(text(form, key), assetType === "holding" ? "units" : "money");
      return value === "" ? [] : [{ assetType, assetId, value }];
    });
  if (values.length === 0) return { error: "Type at least one new value. Blank rows are left as they are." };
  return run(
    () => setValues({ asOf: text(form, "asOf"), note: optional(form, "note"), values }),
    text(form, "back") || "/",
    values.length === 1 ? "Value saved" : `${values.length} values saved`,
  );
}

export async function sellAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      sellInvestment({
        holdingId: text(form, "holdingId"),
        units: units(form, "units"),
        proceedsEUR: money(form, "proceedsEUR") ?? "",
        date: text(form, "date"),
        to: text(form, "to"),
        costBasisEUR: money(form, "costBasisEUR"),
        note: optional(form, "note"),
      }),
    "/",
    "Sale recorded",
  );
}

export async function buyAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  let holding: { isin: string; ticker: string | null } | undefined;
  const isNew = text(form, "holdingId") === "new";
  const result = await run(
    async () => {
      holding = await buyInvestment({
        holdingId: text(form, "holdingId"),
        newHolding: isNew
          ? {
              accountId: text(form, "newAccountId"),
              name: text(form, "newName"),
              ticker: text(form, "newTicker"),
            }
          : null,
        units: units(form, "units") ?? "",
        totalEUR: money(form, "totalEUR") ?? "",
        date: text(form, "date"),
        from: text(form, "from"),
        note: optional(form, "note"),
      });
      if (isNew) await priceNow(holding);
    },
    "/",
    "Purchase recorded",
  );
  return result;
}

export async function moveAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      moveMoney({
        fromAccountId: text(form, "fromAccountId"),
        toAccountId: text(form, "toAccountId"),
        amount: money(form, "amount") ?? "",
        date: text(form, "date"),
        note: optional(form, "note"),
      }),
    "/",
    "Move recorded",
  );
}

// --- Adding things ------------------------------------------------------------

export async function addAccountAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      addAccount({
        name: text(form, "name"),
        type: text(form, "type"),
        balance: money(form, "balance") ?? "0",
        asOf: text(form, "asOf"),
      }),
    "/",
    "Account added",
  );
}

export async function addHoldingAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    async () => {
      const row = await addHolding({
        accountId: text(form, "accountId"),
        name: text(form, "name"),
        ticker: text(form, "ticker"),
        units: units(form, "units") ?? "",
        costEUR: money(form, "costEUR"),
        asOf: text(form, "asOf"),
      });
      await priceNow(row);
    },
    "/",
    "Investment added",
  );
}

export async function addPropertyAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      addProperty({
        name: text(form, "name"),
        value: money(form, "value") ?? "",
        ownershipPct: units(form, "ownershipPct") ?? "100",
        purchasePrice: money(form, "purchasePrice"),
        rentMonthly: money(form, "rentMonthly") ?? "0",
        costsMonthly: money(form, "costsMonthly") ?? "0",
        isPrimaryResidence: checked(form, "isPrimaryResidence"),
        valuedAt: text(form, "valuedAt"),
        mortgageBalance: money(form, "mortgageBalance"),
        mortgageRate: rate(form, "mortgageRate"),
        mortgagePayment: money(form, "mortgagePayment"),
      }),
    "/",
    "Property added",
  );
}

export async function addLiabilityAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      addLiability({
        name: text(form, "name"),
        balance: money(form, "balance") ?? "",
        rate: rate(form, "rate"),
        payment: money(form, "payment"),
        propertyId: optional(form, "propertyId"),
      }),
    "/",
    "Debt added",
  );
}

export async function addOtherAssetAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      addOtherAsset({
        name: text(form, "name"),
        category: text(form, "category") || "other",
        value: money(form, "value") ?? "",
        includeInNetWorth: checked(form, "includeInNetWorth"),
        valuedAt: text(form, "valuedAt"),
        note: optional(form, "note"),
      }),
    "/",
    "Asset added",
  );
}

// --- Item pages ---------------------------------------------------------------

export async function editItemAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const kind = text(form, "kind");
  const id = text(form, "id");
  const back = `/item/${kind}/${id}`;
  return run(
    async () => {
      if (kind === "account") {
        await editAccount({ id, name: text(form, "name"), type: text(form, "type") });
      } else if (kind === "holding") {
        const row = await editHolding({ id, name: text(form, "name"), ticker: text(form, "ticker") });
        await priceNow(row);
      } else if (kind === "property") {
        await editProperty({
          id,
          name: text(form, "name"),
          ownershipPct: units(form, "ownershipPct") ?? "",
          purchasePrice: money(form, "purchasePrice"),
          rentMonthly: money(form, "rentMonthly") ?? "0",
          costsMonthly: money(form, "costsMonthly") ?? "0",
          isPrimaryResidence: checked(form, "isPrimaryResidence"),
        });
      } else if (kind === "debt") {
        await editLiability({ id, name: text(form, "name"), rate: rate(form, "rate"), payment: money(form, "payment") });
      } else if (kind === "other") {
        await editOtherAsset({
          id,
          name: text(form, "name"),
          category: text(form, "category") || "other",
          includeInNetWorth: checked(form, "includeInNetWorth"),
          note: optional(form, "note"),
        });
      }
    },
    back,
    "Details saved",
  );
}

export async function closeItemAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const kind = text(form, "kind");
  const id = text(form, "id");
  return run(
    async () => {
      if (kind === "account") await closeAccount({ accountId: id, moveTo: optional(form, "moveTo") });
      else if (kind === "holding") await removeHolding({ holdingId: id });
      else if (kind === "property") {
        await sellProperty({
          propertyId: id,
          proceedsEUR: money(form, "proceedsEUR") ?? "0",
          toAccountId: optional(form, "toAccountId"),
          date: text(form, "date"),
          note: optional(form, "note"),
        });
      } else if (kind === "debt") {
        await closeLiability({ id, accountId: optional(form, "accountId"), amountEUR: money(form, "amountEUR") });
      } else if (kind === "other") {
        await closeOtherAsset({ id, accountId: optional(form, "accountId"), amountEUR: money(form, "amountEUR") });
      }
    },
    "/",
    "Closed",
  );
}

export async function addLotAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const holdingId = text(form, "holdingId");
  return run(
    () =>
      addLot({
        holdingId,
        buyDate: text(form, "buyDate"),
        units: units(form, "units") ?? "",
        costEUR: money(form, "costEUR") ?? "",
      }),
    `/item/holding/${holdingId}`,
    "Purchase lot added",
  );
}

// --- Tax ----------------------------------------------------------------------

export async function saleBasisAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () => setSaleCostBasis({ saleId: text(form, "saleId"), costBasisEUR: money(form, "costBasisEUR") ?? "" }),
    "/tax",
    "Cost basis saved",
  );
}

export async function voidSaleAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(() => voidSale({ saleId: text(form, "saleId") }), "/tax", "Sale removed from the estimate");
}

export async function taxPaidAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      markTaxPaid({
        year: text(form, "year"),
        amountEUR: money(form, "amountEUR") ?? "",
        paidAt: text(form, "paidAt"),
        fromAccountId: optional(form, "fromAccountId"),
      }),
    "/tax",
    "Marked paid",
  );
}

export async function undoTaxPaidAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(() => undoTaxPaid({ year: text(form, "year") }), "/tax", "Unmarked");
}

// --- Plans and inputs ---------------------------------------------------------

export async function savePlanAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(
    () =>
      savePlan({
        id: optional(form, "id"),
        type: text(form, "type"),
        date: checked(form, "timingUnknown") ? PLAN_TIMING_UNKNOWN_DATE : text(form, "date"),
        amount: checked(form, "amountTBD") ? PLAN_AMOUNT_TBD : (money(form, "amount") ?? ""),
        note: optional(form, "note"),
      }),
    "/plans",
    "Plan saved",
  );
}

export async function completePlanAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(() => completePlan({ id: text(form, "id") }), "/plans", "Plan closed");
}

export async function inputsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  // "Still right" re-saves unchanged values so their review date moves on.
  const reconfirm = checked(form, "reconfirm");
  const changed = PLANNING_INPUTS.flatMap(({ key, kind }) => {
    const raw = text(form, `value-${key}`);
    const value =
      kind === "date"
        ? raw
        : key === "safeWithdrawalRate"
          ? (rate(form, `value-${key}`) ?? "")
          : normalizeNumberInput(raw, "money");
    if (value === "") return [];
    const current = text(form, `current-${key}`);
    const same =
      kind === "date" || !/^\d+(\.\d+)?$/.test(value) || current === ""
        ? value === current
        : dec(value).equals(current);
    return same && !reconfirm ? [] : [{ key, value }];
  });
  return run(() => savePlanningInputs(changed), "/inputs", changed.length ? "Saved" : undefined);
}
