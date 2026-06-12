// The natural-language quick-log context builder. The privacy boundary here is
// the tightest of all four clients: the model receives ONLY the text the user
// just typed — no accounts, no holdings, no balances, no ids, not even names.
// It transcribes mentions and numbers as verbatim spans; the server resolves
// entities locally, resolves relative dates against its own clock, and does
// all arithmetic. Asserted in src/tests/unit/quicklogParse.test.ts.

export type QuicklogParseContext = {
  instructions: string;
  input: string; // JSON: { text } — nothing else, ever
};

const INSTRUCTIONS = `You turn one short note about a personal-finance event into a structured extraction. You TRANSCRIBE — you never compute, never guess a figure, never normalize beyond the literal digits present.

Kinds:
- "movement": money moved or a security traded. Set movementType: deposit (money in from outside), withdraw (money out), buy / sell (a security; capture quantity and/or unit price and/or total), dividend, fee, expense, or transfer ONLY for money arriving from outside.
- "transfer": money between the user's OWN two accounts (mentions with roles fromAccount / toAccount).
- "monthlySpend": a statement of what a month cost ("May was about 2400"). Set month (YYYY-MM) only if the text names one.
- "pensionStatement": a pension plan's stated value on a date (mention role pensionAccount, number role value).
- "clarify": the note is ambiguous or missing something essential (which kind, an amount with no price/quantity to derive it, no recognisable intent). Set clarifyQuestion to ONE short question.

Rules:
- mentions: copy the entity reference EXACTLY as written ("VWCE", "the ING account", "el piso"). Do not invent or expand names.
- numbers: span is the EXACT substring ("1.254,30"); normalized is the same digits as a plain decimal ("1254.30"). Never produce a number whose digits are not in the span. Never multiply, add, or convert.
- date: if the text says "today" or "yesterday", set rel. If it names an explicit date, set iso (YYYY-MM-DD) and span. Otherwise leave all three null — the server defaults to today.
- note: a short remainder of the text worth keeping, or null.
- When essential information is missing, prefer kind "clarify" over guessing.`;

export function buildQuicklogParseContext(text: string): QuicklogParseContext {
  return {
    instructions: INSTRUCTIONS,
    input: JSON.stringify({ text }),
  };
}
