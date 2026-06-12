import { z } from "zod";
import { dec } from "@/calc/money";
import { getQuicklogClient, type QuicklogClientResult } from "@/ai";
import { buildQuicklogParseContext } from "@/ai/quicklogContext";
import {
  verifyExtractionSpans,
  type QuicklogExtraction,
} from "@/ai/quicklogSchema";
import { isoDate } from "@/shared/validation";
import { db } from "./db";
import { accounts, holdings } from "./db/schema";
import { getServerEnv } from "./env";
import {
  monthlySpendInputSchema,
  movementInputSchema,
  revaluationInputSchema,
  transferInputSchema,
  type MonthlySpendInput,
  type MovementInput,
  type RevaluationInput,
  type TransferInput,
} from "./quicklog";

// The natural-language quick-log seam. The model only transcribes (see
// src/ai/quicklogContext.ts); EVERYTHING that decides what gets logged is
// deterministic and lives here: span verification, local entity resolution
// over names/tickers/ISINs, relative-date resolution against the server
// clock, the quantity × price arithmetic, and a final re-parse with the exact
// schemas the manual forms use. The outcome is a PROPOSAL the user confirms —
// nothing is written by this module.

export type CatalogueAccount = {
  id: string;
  name: string;
  type: string;
};

export type CatalogueHolding = {
  id: string;
  name: string;
  ticker: string | null;
  isin: string;
};

type Resolution<T> =
  | { ok: true; entity: T }
  | { ok: false; question: string };

// Local, deterministic entity resolution — the reason the model needs no
// catalogue. Exact ticker/ISIN/name first, then a unique substring match;
// zero or multiple candidates become a clarify question, never a guess.
export function resolveAccountMention(
  mention: string,
  candidates: CatalogueAccount[],
): Resolution<CatalogueAccount> {
  const m = mention.trim().toLowerCase();
  const exact = candidates.filter((a) => a.name.toLowerCase() === m);
  if (exact.length === 1) return { ok: true, entity: exact[0] };
  const partial = candidates.filter(
    (a) =>
      a.name.toLowerCase().includes(m) ||
      m.includes(a.name.toLowerCase()) ||
      m.includes(a.type.toLowerCase()),
  );
  if (partial.length === 1) return { ok: true, entity: partial[0] };
  const names = candidates.map((a) => a.name).join(", ");
  return {
    ok: false,
    question:
      partial.length === 0
        ? `Which account is "${mention}"? Known accounts: ${names}.`
        : `"${mention}" matches several accounts — which one? (${partial
            .map((a) => a.name)
            .join(", ")})`,
  };
}

export function resolveHoldingMention(
  mention: string,
  candidates: CatalogueHolding[],
): Resolution<CatalogueHolding> {
  const m = mention.trim().toLowerCase();
  for (const key of ["ticker", "isin", "name"] as const) {
    const exact = candidates.filter((h) => h[key]?.toLowerCase() === m);
    if (exact.length === 1) return { ok: true, entity: exact[0] };
  }
  const partial = candidates.filter(
    (h) =>
      h.name.toLowerCase().includes(m) ||
      (h.ticker ? h.ticker.toLowerCase().includes(m) : false),
  );
  if (partial.length === 1) return { ok: true, entity: partial[0] };
  const labels = candidates.map((h) => h.ticker ?? h.name).join(", ");
  return {
    ok: false,
    question:
      partial.length === 0
        ? `Which holding is "${mention}"? Known holdings: ${labels}.`
        : `"${mention}" matches several holdings — which one? (${partial
            .map((h) => h.ticker ?? h.name)
            .join(", ")})`,
  };
}

// Relative dates resolve against the server clock; an explicit date must be a
// real, non-future calendar date; nothing stated defaults to today (shown on
// the confirm card before anything is written).
export function resolveDate(
  date: QuicklogExtraction["date"],
  today: string,
): { ok: true; iso: string } | { ok: false; question: string } {
  if (date.rel === "today") return { ok: true, iso: today };
  if (date.rel === "yesterday") {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { ok: true, iso: d.toISOString().slice(0, 10) };
  }
  if (date.iso) {
    const parsed = isoDate.safeParse(date.iso);
    if (!parsed.success || parsed.data > today) {
      return {
        ok: false,
        question: `"${date.span ?? date.iso}" did not resolve to a past date — when was it?`,
      };
    }
    return { ok: true, iso: parsed.data };
  }
  return { ok: true, iso: today };
}

function numberByRole(
  extraction: QuicklogExtraction,
  role: (typeof extraction.numbers)[number]["role"],
): string | null {
  const matches = extraction.numbers.filter((n) => n.role === role);
  return matches.length === 1 ? matches[0].normalized : null;
}

function mentionByRole(
  extraction: QuicklogExtraction,
  role: (typeof extraction.mentions)[number]["role"],
): string | null {
  const matches = extraction.mentions.filter((m) => m.role === role);
  return matches.length === 1 ? matches[0].mention : null;
}

export type QuicklogProposal =
  | {
      kind: "movement";
      input: MovementInput;
      display: { accountName: string; holdingLabel: string | null };
    }
  | {
      kind: "transfer";
      input: TransferInput;
      display: { fromName: string; toName: string };
    }
  | { kind: "monthlySpend"; input: MonthlySpendInput; display: null }
  | {
      kind: "revaluation";
      input: RevaluationInput;
      display: { accountName: string };
    };

export type ProposalOutcome =
  | { ok: true; kind: "proposal"; proposal: QuicklogProposal }
  | { ok: true; kind: "clarify"; question: string }
  | { ok: false; problem: string };

// Pure: a verified extraction + the local catalogue → a fully-resolved
// proposal, a clarify question, or a rejection. Every branch that lacks an
// essential figure asks instead of guessing.
export function buildProposal(args: {
  extraction: QuicklogExtraction;
  accounts: CatalogueAccount[];
  holdings: CatalogueHolding[];
  today: string;
}): ProposalOutcome {
  const { extraction, today } = args;

  if (extraction.kind === "clarify") {
    return {
      ok: true,
      kind: "clarify",
      question:
        extraction.clarifyQuestion ?? "Could you say that with a bit more detail?",
    };
  }

  const clarify = (question: string): ProposalOutcome => ({
    ok: true,
    kind: "clarify",
    question,
  });

  const date = resolveDate(extraction.date, today);
  if (!date.ok) return clarify(date.question);

  if (extraction.kind === "movement") {
    if (!extraction.movementType) {
      return clarify("What kind of movement is this? (deposit, withdrawal, buy, sell, dividend, fee, expense)");
    }
    const accountMention = mentionByRole(extraction, "account");
    if (!accountMention) {
      return clarify("Which account does this belong to?");
    }
    const account = resolveAccountMention(accountMention, args.accounts);
    if (!account.ok) return clarify(account.question);

    const trades =
      extraction.movementType === "buy" || extraction.movementType === "sell";
    let holdingId: string | null = null;
    let holdingLabel: string | null = null;
    let quantity: string | null = null;
    let amount = numberByRole(extraction, "amount");

    if (trades) {
      const holdingMention = mentionByRole(extraction, "holding");
      if (!holdingMention) return clarify("Which holding was traded?");
      const holding = resolveHoldingMention(holdingMention, args.holdings);
      if (!holding.ok) return clarify(holding.question);
      holdingId = holding.entity.id;
      holdingLabel = holding.entity.ticker ?? holding.entity.name;

      quantity = numberByRole(extraction, "quantity");
      if (!quantity) return clarify("How many units?");

      if (!amount) {
        const unitPrice = numberByRole(extraction, "unitPrice");
        if (!unitPrice) {
          return clarify(
            "What was the total amount (or the price per unit) in EUR?",
          );
        }
        // The one computation in the flow — server-side, exact decimals.
        amount = dec(quantity).times(unitPrice).toFixed(2);
      }
    } else if (!amount) {
      return clarify("What was the amount in EUR?");
    }

    const input = movementInputSchema.safeParse({
      type: extraction.movementType,
      accountId: account.entity.id,
      holdingId,
      quantity,
      amount,
      occurredAt: date.iso,
      note: extraction.note,
    });
    if (!input.success) {
      return { ok: false, problem: input.error.issues[0]?.message ?? "invalid movement" };
    }
    return {
      ok: true,
      kind: "proposal",
      proposal: {
        kind: "movement",
        input: input.data,
        display: { accountName: account.entity.name, holdingLabel },
      },
    };
  }

  if (extraction.kind === "transfer") {
    const fromMention = mentionByRole(extraction, "fromAccount");
    const toMention = mentionByRole(extraction, "toAccount");
    if (!fromMention || !toMention) {
      return clarify("Which two accounts did the money move between?");
    }
    const from = resolveAccountMention(fromMention, args.accounts);
    if (!from.ok) return clarify(from.question);
    const to = resolveAccountMention(toMention, args.accounts);
    if (!to.ok) return clarify(to.question);
    const amount = numberByRole(extraction, "amount");
    if (!amount) return clarify("How much moved, in EUR?");

    const input = transferInputSchema.safeParse({
      fromAccountId: from.entity.id,
      toAccountId: to.entity.id,
      amount,
      occurredAt: date.iso,
      note: extraction.note,
    });
    if (!input.success) {
      return { ok: false, problem: input.error.issues[0]?.message ?? "invalid transfer" };
    }
    return {
      ok: true,
      kind: "proposal",
      proposal: {
        kind: "transfer",
        input: input.data,
        display: { fromName: from.entity.name, toName: to.entity.name },
      },
    };
  }

  if (extraction.kind === "monthlySpend") {
    const amount = numberByRole(extraction, "spendAmount") ?? numberByRole(extraction, "amount");
    if (!amount) return clarify("How much was spent that month, in EUR?");
    const input = monthlySpendInputSchema.safeParse({
      month: extraction.month ?? today.slice(0, 7),
      amount,
      note: extraction.note,
    });
    if (!input.success) {
      return { ok: false, problem: input.error.issues[0]?.message ?? "invalid monthly spend" };
    }
    return {
      ok: true,
      kind: "proposal",
      proposal: { kind: "monthlySpend", input: input.data, display: null },
    };
  }

  // pensionStatement → a revaluation proposal.
  const pensions = args.accounts.filter((a) => a.type === "pension");
  const pensionMention =
    mentionByRole(extraction, "pensionAccount") ??
    mentionByRole(extraction, "account");
  const pension =
    pensionMention !== null
      ? resolveAccountMention(pensionMention, pensions)
      : pensions.length === 1
        ? ({ ok: true, entity: pensions[0] } as const)
        : null;
  if (!pension) return clarify("Which pension account is the statement for?");
  if (!pension.ok) return clarify(pension.question);
  const value = numberByRole(extraction, "value") ?? numberByRole(extraction, "amount");
  if (!value) return clarify("What value does the statement show, in EUR?");

  const input = revaluationInputSchema.safeParse({
    accountId: pension.entity.id,
    value,
    valuedAt: date.iso,
    note: extraction.note,
  });
  if (!input.success) {
    return { ok: false, problem: input.error.issues[0]?.message ?? "invalid statement" };
  }
  return {
    ok: true,
    kind: "proposal",
    proposal: {
      kind: "revaluation",
      input: input.data,
      display: { accountName: pension.entity.name },
    },
  };
}

// --- The orchestration seam (injectable deps, reasons not throws) ----------

const textSchema = z.string().trim().min(3).max(400);

export type QuicklogParseFailure =
  | "invalid-text"
  | "no-key"
  | "provider-error"
  | "rejected"; // span verification or final schema failed — fall back to forms

export type QuicklogParseResult =
  | { ok: true; kind: "proposal"; proposal: QuicklogProposal }
  | { ok: true; kind: "clarify"; question: string }
  | { ok: false; reason: QuicklogParseFailure; detail?: string };

export type QuicklogParseDeps = {
  apiKey: () => string | undefined;
  clientFor: (opts: { apiKey: string | undefined }) => QuicklogClientResult;
  catalogue: () => Promise<{
    accounts: CatalogueAccount[];
    holdings: CatalogueHolding[];
  }>;
  today: () => string;
};

async function loadCatalogue() {
  const [accountRows, holdingRows] = await Promise.all([
    db.select().from(accounts),
    db.select().from(holdings),
  ]);
  return {
    accounts: accountRows
      .filter((a) => !a.disposedAt)
      .map((a) => ({ id: a.id, name: a.name, type: a.type })),
    holdings: holdingRows
      .filter((h) => !h.disposedAt)
      .map((h) => ({ id: h.id, name: h.name, ticker: h.ticker, isin: h.isin })),
  };
}

const defaultDeps: QuicklogParseDeps = {
  apiKey: () => getServerEnv().OPENAI_API_KEY,
  clientFor: getQuicklogClient,
  catalogue: loadCatalogue,
  today: () => new Date().toISOString().slice(0, 10),
};

export async function parseQuicklogText(
  rawText: unknown,
  deps: QuicklogParseDeps = defaultDeps,
): Promise<QuicklogParseResult> {
  const text = textSchema.safeParse(rawText);
  if (!text.success) return { ok: false, reason: "invalid-text" };

  const gate = deps.clientFor({ apiKey: deps.apiKey() });
  if (!gate.ok) return { ok: false, reason: gate.reason };

  let extraction: QuicklogExtraction;
  try {
    const result = await gate.client.parse(buildQuicklogParseContext(text.data));
    extraction = result.extraction;
  } catch (err) {
    return {
      ok: false,
      reason: "provider-error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const spans = verifyExtractionSpans(extraction, text.data);
  if (!spans.ok) {
    return { ok: false, reason: "rejected", detail: spans.problem };
  }

  const catalogue = await deps.catalogue();
  const outcome = buildProposal({
    extraction,
    accounts: catalogue.accounts,
    holdings: catalogue.holdings,
    today: deps.today(),
  });
  if (!outcome.ok) {
    return { ok: false, reason: "rejected", detail: outcome.problem };
  }
  return outcome;
}
