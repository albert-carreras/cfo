# AI check and decision handoff

## Monthly check

The AI has one narrow job: periodically read a deterministic summary and say whether the current
position looks broadly okay, worth watching, or needs fresher data.

The request uses the Responses API with strict JSON output, `store:false`, no tools and no web.
`gpt-5.6-sol` is the default model and `OPENAI_MODEL` may override it. The output is a headline and
at most three observations. Validation removes any sentence containing digits so the voice cannot
originate or repeat a personal figure.

The deterministic verdict is a floor. The model may strengthen `ok → watch → update`; it may not
weaken a warning. Without an API key or after a provider error, the check is still stored and shown
with its deterministic verdict.

The check does not research regulation, estimate tax, model plans, recommend trades or make
decisions. Those responsibilities created false precision and duplicated a better general AI chat.

## Markdown context pack

`GET /api/export` produces an explicit handoff containing:

- current calculated net worth buckets, debt and independence metrics;
- verified accounts, quantities, properties, other assets and liabilities with dates;
- planning assumptions, open plans and tax-lot cost-basis summaries;
- data freshness, known gaps and the latest check;
- instructions to distinguish facts/calculations/judgment and ask before assuming missing terms.

The pack is designed to be uploaded to a persistent ChatGPT or Claude project. For example: “Given
this record, how much mortgage should I take for a particular house?” The external assistant should
ask for the decision-specific financing, tax and lifestyle facts that the pack marks missing.

## Model privacy

Only the compact health summary goes to the provider automatically. Raw movements, provenance ids
and the full Markdown export do not. Exporting and uploading the context pack is a deliberate user
action.
