"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  appendMovement,
  appendTransfer,
  logMonthlySpend,
  logRevaluation,
} from "@/server/quicklog";
import {
  parseQuicklogText,
  type QuicklogParseResult,
} from "@/server/quicklogParse";

// Free text → a structured proposal (or a clarify question). Read-only: the
// model transcribes, the server resolves and validates, and NOTHING is
// written until the user confirms the card — confirmation posts through the
// same submit actions as the manual forms.
export async function parseQuickLog(text: string): Promise<QuicklogParseResult> {
  return parseQuicklogText(text);
}

// Both actions funnel into the same validated quick-log seam as the API route.
export async function submitMovement(formData: FormData) {
  await appendMovement({
    type: formData.get("type"),
    accountId: formData.get("accountId"),
    holdingId: formData.get("holdingId") || null,
    quantity: formData.get("quantity") || null,
    amount: formData.get("amount"),
    occurredAt: formData.get("occurredAt"),
    note: formData.get("note") || null,
  });
  revalidatePath("/");
  redirect("/");
}

// One intent, both legs — the server writes withdraw + transfer in
// one transaction so quick-log can never produce a one-sided transfer.
export async function submitTransfer(formData: FormData) {
  await appendTransfer({
    fromAccountId: formData.get("fromAccountId"),
    toAccountId: formData.get("toAccountId"),
    amount: formData.get("amount"),
    occurredAt: formData.get("occurredAt"),
    note: formData.get("note") || null,
  });
  revalidatePath("/");
  redirect("/");
}

// Dated pension statement — appends a revaluation fact; the account
// re-anchors to it (value = statement + movements since).
export async function submitRevaluation(formData: FormData) {
  await logRevaluation({
    accountId: formData.get("accountId"),
    value: formData.get("value"),
    valuedAt: formData.get("valuedAt"),
    note: formData.get("note") || null,
  });
  revalidatePath("/");
  redirect("/");
}

export async function submitMonthlySpend(formData: FormData) {
  await logMonthlySpend({
    month: formData.get("month"),
    amount: formData.get("amount"),
    note: formData.get("note") || null,
  });
  revalidatePath("/");
  redirect("/");
}
