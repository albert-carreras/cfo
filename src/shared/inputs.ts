import { z } from "zod";
import { dec } from "@/calc/money";
import { nonNegativeDecimalString } from "./validation";

// Shared, client-importable vocabulary for the input forms.

export const ACCOUNT_TYPES = ["bank", "broker", "pension", "manual"] as const;
export type AccountTypeKey = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeKey, string> = {
  bank: "Bank / savings",
  broker: "Broker",
  pension: "Pension",
  manual: "Cash / other",
};

export const OTHER_ASSET_CATEGORIES = ["vehicle", "business", "collectible", "other"] as const;

export const percentString = nonNegativeDecimalString.refine(
  (v) => dec(v).greaterThan(0) && dec(v).lessThanOrEqualTo(100),
  "must be between 0 (exclusive) and 100",
);

// The planning inputs a person edits. Spend and the withdrawal rate drive the
// safe-spending line; income and housing cost travel only in the export,
// where a decision conversation needs them.
export const PLANNING_INPUTS = [
  {
    key: "monthlySpend",
    label: "Monthly spending",
    help: "What you spend in a normal month, in euros.",
    kind: "number",
  },
  {
    key: "safeWithdrawalRate",
    label: "Safe withdrawal rate",
    help: "Share of cash + investments you could draw each year. 0.035 = 3.5%.",
    kind: "number",
  },
  {
    key: "monthlyNetIncome",
    label: "Monthly net income",
    help: "Only used in the export, for affordability questions.",
    kind: "number",
  },
  {
    key: "monthlyHousingCost",
    label: "Monthly housing cost",
    help: "Rent, mortgage and fixed housing costs. Only used in the export.",
    kind: "number",
  },
  {
    key: "birthDate",
    label: "Date of birth",
    help: "Age context for the export.",
    kind: "date",
  },
] as const;

export type PlanningInputKey = (typeof PLANNING_INPUTS)[number]["key"];

// Sanity ranges that reject typos (a 35% withdrawal rate), not opinions.
export const ASSUMPTION_RANGES: Record<string, { min: string; max: string }> = {
  safeWithdrawalRate: { min: "0", max: "0.2" },
  monthlySpend: { min: "0", max: "1000000" },
  monthlyNetIncome: { min: "0", max: "1000000" },
  monthlyHousingCost: { min: "0", max: "1000000" },
};

// Optional form field: blank means "not given".
export const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullish();
