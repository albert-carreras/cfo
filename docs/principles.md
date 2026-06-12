# Principles — the non-negotiables

These are load-bearing. Everything else is implementation detail.

## 1. The anxiety firewall governs presentation, not engine depth
The brain can be deep and complex. The *surface* is what stays calm. You don't need a dumb app
— you need a deep app that doesn't constantly poke you. The firewall lives in the UI and the
status engine, never in the calculators.

## 2. Three kinds of information — always labelled distinctly
Never blur these in the UI. Each is a different epistemic category:

- **Verified** — a fact you entered or imported. *"I own 2,752 VWCE shares."*
- **Calculated** — a deterministic output. *"VWCE value = quantity × price."*
- **Judgment** — an opinion (LLM or rule-of-thumb). *"Tech exposure is high but acceptable."*

The UI labels them differently (e.g. a small `Verified` / `Calculated` / `Judgment` tag on
every figure or statement). This separation is the spine of the whole product.

## 3. Calculators compute; the LLM never originates a number about you
Every figure the app shows about *you* comes from a deterministic calculator output, which in
turn comes from a Verified fact. The LLM explains, compares and advises — it does not invent
your numbers.

## 4. Provenance everywhere
Every figure links back to the fact / movement / price that produced it, with a date. The
append-only ledger and the git history of facts are the audit log.

## 5. Pull before proactive
The analyst answers **when asked**. It may say *"this deserves a review."* It does **not** push
market opinions at you. A background "AI researches and pings you" is exactly the
pseudo-financial noise this app exists to remove — e.g. *"Action recommended: semiconductor
valuations appear stretched."* That is banned until very late, and even then only inside a
**scheduled** review, never as a real-time alert.

## 6. Manual-review lock on irreversible actions
The app is **not allowed to sound certain** about scary, hard-to-reverse decisions. These
require explicit manual review before they can ever become an "action":

- sell a property
- quit the job
- sell a large ETF position (e.g. > €100k)
- pension withdrawal

For these, the strongest the app may say is:
*"This recommendation requires manual review before becoming an action."*

## 7. Two different "we're not sure" signals
Keep these separate:

- **Data quality** — do we have enough, fresh inputs? *"Data quality: Good. Missing: May
  spending, latest pension value."*
- **FIRE confidence** — given the inputs, is the plan sound?

Sometimes the right status is not "danger" — it's *"we don't know enough."* Don't collapse the
two.

## 8. Calm surface, deep brain
Home shows: status · next strategic snapshot · data freshness. Full net worth, allocation and
in-depth reports are **one tap away** — never blocked, never shoved at you.

## 9. "Data stale" is a first-class status
Alongside Stable / Review soon / Action recommended / Urgent. Honest staleness beats false
calm.

## 10. Tax numbers are planning estimates — show the source, not a disclaimer
Don't editorialise ("I'm not your gestor"). State it factually:
*"Tax estimates are planning estimates. Source / version shown."* Then show the tax-table
version that produced the number.

## 11. The confidence score moves slowly
A market crash should nudge it (e.g. 91 → 86), not crater it. Smoothed, not reactive.

## 12. Coarse by design — the surface thinks in years and percent, not euros
Spend is a coarse planning **assumption** reviewed yearly, not a hand-logged monthly figure; the
calm surface rounds to ~€1k (net worth to three significant figures) and presents runway in
years. A ±€1,000/month imprecision must not matter anywhere the user normally looks — if it does,
the design is wrong, not the rounding. Full precision lives on in the calculators and the
provenance depth; only the presentation coarsens. Corollary: a quiet ledger is a feature — the
app must never nag for precision it doesn't use.

## 13. The AI provider is an implementation detail
The model lives behind an interface (`src/ai/*`). The product is not "a GPT-5.5 app" or "a
Claude app" — the deterministic core is provider-agnostic and the voice is swappable. Don't
bake a provider name into the product design.
