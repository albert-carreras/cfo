import { describe, expect, it } from "vitest";
import {
  quicklogExtractionSchema,
  verifyExtractionSpans,
  type QuicklogExtraction,
} from "@/ai/quicklogSchema";
import { buildQuicklogParseContext } from "@/ai/quicklogContext";
import { buildQuicklogRequestBody } from "@/ai/openai";
import { createFakeQuicklogClient } from "@/ai/fake";
import { getQuicklogClient } from "@/ai";
import {
  buildProposal,
  parseQuicklogText,
  resolveAccountMention,
  resolveDate,
  resolveHoldingMention,
  type QuicklogParseDeps,
} from "@/server/quicklogParse";

const TODAY = "2026-06-11";

const ACCOUNTS = [
  { id: "acc_bank", name: "Bank — current account", type: "bank" },
  { id: "acc_broker", name: "Broker (ETFs)", type: "broker" },
  { id: "acc_pension", name: "Pension plan", type: "pension" },
];

const HOLDINGS = [
  { id: "hold_vwce", name: "Vanguard FTSE All-World", ticker: "VWCE", isin: "IE00BK5BQT80" },
  { id: "hold_smh", name: "VanEck Semiconductor ETF", ticker: "SMH", isin: "US92189F7915" },
];

function extraction(partial: Partial<QuicklogExtraction>): QuicklogExtraction {
  return {
    kind: "movement",
    movementType: null,
    mentions: [],
    numbers: [],
    date: { rel: null, iso: null, span: null },
    month: null,
    note: null,
    clarifyQuestion: null,
    ...partial,
  };
}

const SELL_TEXT = "sold 10 VWCE yesterday at 130";
const sellExtraction = extraction({
  movementType: "sell",
  mentions: [
    { role: "account", mention: "VWCE" }, // intentionally not used for account
    { role: "holding", mention: "VWCE" },
  ],
  numbers: [
    { role: "quantity", span: "10", normalized: "10" },
    { role: "unitPrice", span: "130", normalized: "130" },
  ],
  date: { rel: "yesterday", iso: null, span: "yesterday" },
});

describe("quicklog extraction schema & span verification", () => {
  it("accepts a well-formed extraction", () => {
    expect(quicklogExtractionSchema.safeParse(sellExtraction).success).toBe(true);
  });

  it("rejects unknown kinds and loose objects", () => {
    expect(
      quicklogExtractionSchema.safeParse(extraction({ kind: "delete" as never }))
        .success,
    ).toBe(false);
    expect(
      quicklogExtractionSchema.safeParse({ ...sellExtraction, extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects a mention the user never typed", () => {
    const r = verifyExtractionSpans(
      extraction({ mentions: [{ role: "holding", mention: "AGGH" }] }),
      SELL_TEXT,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a normalized number whose digits differ from its span", () => {
    const invented = extraction({
      numbers: [{ role: "amount", span: "130", normalized: "1300" }],
    });
    const r = verifyExtractionSpans(invented, SELL_TEXT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("does not transcribe");
  });

  it("accepts locale-formatted transcription (1.254,30 → 1254.30)", () => {
    const r = verifyExtractionSpans(
      extraction({
        numbers: [{ role: "amount", span: "1.254,30", normalized: "1254.30" }],
      }),
      "deposited 1.254,30 into the bank",
    );
    expect(r.ok).toBe(true);
  });
});

describe("local entity resolution", () => {
  it("resolves a unique substring account mention", () => {
    const r = resolveAccountMention("the bank", ACCOUNTS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entity.id).toBe("acc_bank");
  });

  it("asks when a mention matches nothing or several", () => {
    const none = resolveAccountMention("revolut", ACCOUNTS);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.question).toContain("Known accounts");
    const many = resolveAccountMention("account", [
      ...ACCOUNTS,
      { id: "acc_2", name: "Second current account", type: "bank" },
    ]);
    expect(many.ok).toBe(false);
  });

  it("resolves holdings by ticker, ISIN and name", () => {
    expect(resolveHoldingMention("vwce", HOLDINGS)).toMatchObject({
      ok: true,
      entity: { id: "hold_vwce" },
    });
    expect(resolveHoldingMention("US92189F7915", HOLDINGS)).toMatchObject({
      ok: true,
      entity: { id: "hold_smh" },
    });
    expect(resolveHoldingMention("semiconductor", HOLDINGS)).toMatchObject({
      ok: true,
      entity: { id: "hold_smh" },
    });
    expect(resolveHoldingMention("van", HOLDINGS).ok).toBe(false); // Vanguard vs VanEck — ambiguous
  });
});

describe("date resolution", () => {
  it("resolves relative dates against the server clock", () => {
    expect(resolveDate({ rel: "today", iso: null, span: null }, TODAY)).toEqual({
      ok: true,
      iso: "2026-06-11",
    });
    expect(
      resolveDate({ rel: "yesterday", iso: null, span: "yesterday" }, TODAY),
    ).toEqual({ ok: true, iso: "2026-06-10" });
  });

  it("defaults to today and refuses future dates", () => {
    expect(resolveDate({ rel: null, iso: null, span: null }, TODAY)).toEqual({
      ok: true,
      iso: TODAY,
    });
    expect(
      resolveDate({ rel: null, iso: "2027-01-01", span: "next year" }, TODAY).ok,
    ).toBe(false);
  });
});

describe("buildProposal — the deterministic half", () => {
  const args = { accounts: ACCOUNTS, holdings: HOLDINGS, today: TODAY };

  it("computes the total server-side: 10 × 130 → 1300.00, dated yesterday", () => {
    const sellWithAccount = {
      ...sellExtraction,
      mentions: [
        { role: "account" as const, mention: "Broker" },
        { role: "holding" as const, mention: "VWCE" },
      ],
    };
    const r = buildProposal({ ...args, extraction: sellWithAccount });
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: {
        kind: "movement",
        input: {
          type: "sell",
          accountId: "acc_broker",
          holdingId: "hold_vwce",
          quantity: "10",
          amount: "1300.00",
          occurredAt: "2026-06-10",
        },
        display: { accountName: "Broker (ETFs)", holdingLabel: "VWCE" },
      },
    });
  });

  it("a stated total wins over the multiplication", () => {
    const stated = extraction({
      movementType: "buy",
      mentions: [
        { role: "account", mention: "Broker" },
        { role: "holding", mention: "VWCE" },
      ],
      numbers: [
        { role: "quantity", span: "10", normalized: "10" },
        { role: "unitPrice", span: "130", normalized: "130" },
        { role: "amount", span: "1305", normalized: "1305" },
      ],
    });
    const r = buildProposal({ ...args, extraction: stated });
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: { input: { amount: "1305" } },
    });
  });

  it("asks instead of guessing when the amount is underdetermined", () => {
    const noPrice = extraction({
      movementType: "sell",
      mentions: [
        { role: "account", mention: "Broker" },
        { role: "holding", mention: "VWCE" },
      ],
      numbers: [{ role: "quantity", span: "10", normalized: "10" }],
    });
    const r = buildProposal({ ...args, extraction: noPrice });
    expect(r).toMatchObject({ ok: true, kind: "clarify" });
  });

  it("builds a transfer between two resolved accounts", () => {
    const transfer = extraction({
      kind: "transfer",
      mentions: [
        { role: "fromAccount", mention: "the bank" },
        { role: "toAccount", mention: "Broker" },
      ],
      numbers: [{ role: "amount", span: "2000", normalized: "2000" }],
    });
    const r = buildProposal({ ...args, extraction: transfer });
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: {
        kind: "transfer",
        input: { fromAccountId: "acc_bank", toAccountId: "acc_broker" },
      },
    });
  });

  it("monthly spend defaults to the current month", () => {
    const spend = extraction({
      kind: "monthlySpend",
      numbers: [{ role: "spendAmount", span: "2400", normalized: "2400" }],
    });
    const r = buildProposal({ ...args, extraction: spend });
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: { kind: "monthlySpend", input: { month: "2026-06" } },
    });
  });

  it("a pension statement falls back to the single pension account", () => {
    const statement = extraction({
      kind: "pensionStatement",
      numbers: [{ role: "value", span: "87.200", normalized: "87200" }],
      date: { rel: null, iso: "2026-05-31", span: "31 May" },
    });
    const r = buildProposal({ ...args, extraction: statement });
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: {
        kind: "revaluation",
        input: { accountId: "acc_pension", value: "87200", valuedAt: "2026-05-31" },
      },
    });
  });

  it("clarify extractions pass straight through", () => {
    const r = buildProposal({
      ...args,
      extraction: extraction({ kind: "clarify", clarifyQuestion: "Which account?" }),
    });
    expect(r).toEqual({ ok: true, kind: "clarify", question: "Which account?" });
  });
});

describe("parseQuicklogText — the seam", () => {
  function deps(overrides: Partial<QuicklogParseDeps>): QuicklogParseDeps {
    return {
      apiKey: () => "k",
      clientFor: () => ({
        ok: true,
        client: createFakeQuicklogClient(sellExtraction),
      }),
      catalogue: async () => ({ accounts: ACCOUNTS, holdings: HOLDINGS }),
      today: () => TODAY,

      ...overrides,
    };
  }

  it("a missing key resolves before any provider code", async () => {
    expect(
      await parseQuicklogText(SELL_TEXT, deps({
        apiKey: () => undefined,
        clientFor: getQuicklogClient,
      })),
    ).toEqual({ ok: false, reason: "no-key" });
  });

  it("a verified extraction becomes a proposal", async () => {
    const fixed = {
      ...sellExtraction,
      mentions: [
        { role: "account" as const, mention: "VWCE" },
        { role: "holding" as const, mention: "VWCE" },
      ],
    };
    const r = await parseQuicklogText(
      SELL_TEXT,
      deps({
        clientFor: () => ({ ok: true, client: createFakeQuicklogClient(fixed) }),
        catalogue: async () => ({
          // "VWCE" as an account mention resolves nowhere — but the broker is
          // unique by holding ownership? No: it clarifies. Use a catalogue
          // where the account mention resolves: rename for the test.
          accounts: [{ id: "acc_broker", name: "VWCE broker", type: "broker" }],
          holdings: HOLDINGS,
        }),
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      kind: "proposal",
      proposal: { kind: "movement", input: { amount: "1300.00" } },
    });
  });

  it("an extraction with invented digits is rejected, never proposed", async () => {
    const invented = {
      ...sellExtraction,
      numbers: [{ role: "amount" as const, span: "130", normalized: "13000" }],
    };
    const r = await parseQuicklogText(
      SELL_TEXT,
      deps({
        clientFor: () => ({ ok: true, client: createFakeQuicklogClient(invented) }),
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("a provider failure is a reason, not a throw", async () => {
    const r = await parseQuicklogText(
      SELL_TEXT,
      deps({
        clientFor: () => ({
          ok: true,
          client: {
            parse: async () => {
              throw new Error("boom");
            },
          },
        }),
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "provider-error" });
  });
});

describe("the privacy boundary", () => {
  it("the model input carries the user's text and nothing else", () => {
    const ctx = buildQuicklogParseContext("sold 10 VWCE yesterday at 130");
    expect(JSON.parse(ctx.input)).toEqual({
      text: "sold 10 VWCE yesterday at 130",
    });
  });

  it("the request body is store:false, schema-strict, tool-free", () => {
    const body = buildQuicklogRequestBody(
      buildQuicklogParseContext("paid a 12 euro fee at the bank"),
      "test-model",
    );
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect("tools" in body).toBe(false);
    expect(body.input).not.toContain("acc_");
    expect(body.input).not.toContain("hold_");
  });
});
