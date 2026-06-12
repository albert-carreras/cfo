"use client";

import { useState } from "react";
import type { QuicklogParseResult } from "@/server/quicklogParse";
import {
  parseQuickLog,
  submitMonthlySpend,
  submitMovement,
  submitRevaluation,
  submitTransfer,
} from "./actions";

// The free-text entry box. The confirm card below is rendered purely from the
// parsed, server-resolved struct — never from model prose — and confirming
// dispatches the exact same submit actions as the manual forms, so the same
// validation and the same in-transaction checks apply.

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="fine-print">{label}</dt>
      <dd className="mt-1 tabular-nums">{value}</dd>
    </div>
  );
}

export function NlLog({ status }: { status: "ok" | "no-key" }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<QuicklogParseResult | null>(null);

  if (status !== "ok") {
    return (
      <p className="fine-print mb-8">
        Free-text logging needs the provider key — the manual forms below work
        without it.
      </p>
    );
  }

  async function parse() {
    setPending(true);
    setResult(null);
    try {
      setResult(await parseQuickLog(text));
    } finally {
      setPending(false);
    }
  }

  const proposal = result?.ok && result.kind === "proposal" ? result.proposal : null;

  return (
    <div className="card mb-8 p-5 sm:p-6">
      <div className="eyebrow mb-3">Just type it</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder='"sold 10 VWCE yesterday at 130" · "May was about 2400" · "moved 2000 from the bank to the broker"'
          className="control flex-1"
        />
        <button
          type="button"
          className="button-primary self-end"
          disabled={pending || text.trim().length < 3}
          onClick={parse}
        >
          {pending ? "Reading…" : "Propose entry"}
        </button>
      </div>
      <p className="field-help mt-2">
        The model only transcribes your words; every figure is resolved and
        validated deterministically, and nothing is written until you confirm.
      </p>

      {result && !result.ok && (
        <p className="notice notice-amber mt-4 text-sm leading-6">
          {result.reason === "provider-error"
            ? "The parser is unreachable right now — use the forms below."
            : result.reason === "rejected"
              ? `That didn't parse safely (${result.detail ?? "unverifiable figures"}) — use the forms below.`
              : "That was too short to read — try a fuller sentence or the forms below."}
        </p>
      )}

      {result?.ok && result.kind === "clarify" && (
        <p className="notice notice-sky mt-4 text-sm leading-6">
          {result.question}
        </p>
      )}

      {proposal && (
        <div className="mt-5 border border-[var(--ink)] bg-[var(--paper-bright)] p-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2">
            <div className="eyebrow">
              {proposal.kind === "movement" && `Proposed ${proposal.input.type}`}
              {proposal.kind === "transfer" && "Proposed transfer"}
              {proposal.kind === "monthlySpend" && "Proposed monthly spend"}
              {proposal.kind === "revaluation" && "Proposed pension statement"}
            </div>
            <button
              type="button"
              className="button-quiet text-xs"
              onClick={() => setResult(null)}
            >
              Discard
            </button>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
            {proposal.kind === "movement" && (
              <>
                <CardRow label="Account" value={proposal.display.accountName} />
                {proposal.display.holdingLabel && (
                  <CardRow label="Holding" value={proposal.display.holdingLabel} />
                )}
                {proposal.input.quantity && (
                  <CardRow label="Quantity" value={proposal.input.quantity} />
                )}
                <CardRow label="Amount" value={`€${proposal.input.amount}`} />
                <CardRow label="Date" value={proposal.input.occurredAt} />
              </>
            )}
            {proposal.kind === "transfer" && (
              <>
                <CardRow label="From" value={proposal.display.fromName} />
                <CardRow label="To" value={proposal.display.toName} />
                <CardRow label="Amount" value={`€${proposal.input.amount}`} />
                <CardRow label="Date" value={proposal.input.occurredAt} />
              </>
            )}
            {proposal.kind === "monthlySpend" && (
              <>
                <CardRow label="Month" value={proposal.input.month} />
                <CardRow label="Amount" value={`€${proposal.input.amount}`} />
              </>
            )}
            {proposal.kind === "revaluation" && (
              <>
                <CardRow label="Pension" value={proposal.display.accountName} />
                <CardRow label="Statement value" value={`€${proposal.input.value}`} />
                <CardRow label="Statement date" value={proposal.input.valuedAt} />
              </>
            )}
          </dl>

          {proposal.kind === "movement" && (
            <form action={submitMovement} className="mt-4 flex justify-end">
              <input type="hidden" name="type" value={proposal.input.type} />
              <input type="hidden" name="accountId" value={proposal.input.accountId} />
              <input type="hidden" name="holdingId" value={proposal.input.holdingId ?? ""} />
              <input type="hidden" name="quantity" value={proposal.input.quantity ?? ""} />
              <input type="hidden" name="amount" value={proposal.input.amount} />
              <input type="hidden" name="occurredAt" value={proposal.input.occurredAt} />
              <input type="hidden" name="note" value={proposal.input.note ?? ""} />
              <button type="submit" className="button-primary">
                Confirm & append
              </button>
            </form>
          )}
          {proposal.kind === "transfer" && (
            <form action={submitTransfer} className="mt-4 flex justify-end">
              <input type="hidden" name="fromAccountId" value={proposal.input.fromAccountId} />
              <input type="hidden" name="toAccountId" value={proposal.input.toAccountId} />
              <input type="hidden" name="amount" value={proposal.input.amount} />
              <input type="hidden" name="occurredAt" value={proposal.input.occurredAt} />
              <input type="hidden" name="note" value={proposal.input.note ?? ""} />
              <button type="submit" className="button-primary">
                Confirm & append
              </button>
            </form>
          )}
          {proposal.kind === "monthlySpend" && (
            <form action={submitMonthlySpend} className="mt-4 flex justify-end">
              <input type="hidden" name="month" value={proposal.input.month} />
              <input type="hidden" name="amount" value={proposal.input.amount} />
              <input type="hidden" name="note" value={proposal.input.note ?? ""} />
              <button type="submit" className="button-primary">
                Confirm & log
              </button>
            </form>
          )}
          {proposal.kind === "revaluation" && (
            <form action={submitRevaluation} className="mt-4 flex justify-end">
              <input type="hidden" name="accountId" value={proposal.input.accountId} />
              <input type="hidden" name="value" value={proposal.input.value} />
              <input type="hidden" name="valuedAt" value={proposal.input.valuedAt} />
              <input type="hidden" name="note" value={proposal.input.note ?? ""} />
              <button type="submit" className="button-primary">
                Confirm & append
              </button>
            </form>
          )}

          <p className="field-help mt-3">
            Wrong in any detail? Discard and use the forms below — nothing has
            been written yet.
          </p>
        </div>
      )}
    </div>
  );
}
