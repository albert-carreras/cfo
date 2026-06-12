# The voice — Ask layer & Review analyst

The LLM is added **only after the trust core is reliable**. It lives behind
`src/ai/*` and is **pull-first**. It never sees raw account data — only **calculator JSON plus
assumption summaries** (the scalar judgment inputs you entered: spend, SWR, birthDate, …, so it
can cite them as provenance). Never accounts, holdings, movements, prices, documents, or the
`CalcResult.inputs` id lists (`src/ai/context.ts` is the boundary; asserted in
`src/tests/unit/askContext.test.ts`).

## Pull-first Ask layer

Flow:

1. You ask a question ("Can I quit in June 2027?", "What if markets drop 40%?").
2. The app assembles a **calculator snapshot** (deterministic JSON) — never a raw account dump.
3. The model answers, with **every statement labelled**:
   - **Verified** — a fact you entered
   - **Calculated** — a deterministic output, cited to its calculator snapshot
   - **Judgment** — the model's opinion
4. The answer **cites internal sources** (which facts/snapshots it used).
5. The model may end with *"this deserves a review"* — a suggestion, never a push.

It explains, compares and advises. It does **not** originate your numbers, and it does **not**
volunteer unprompted market opinions.

### As built — how "never originates a number" is enforced

Labelling alone can't stop a model from stating a wrong figure while citing the right source, so
the enforcement is deterministic, in `src/ai/schema.ts`:

- **Figures travel as metric tokens, not text.** The context (`src/ai/context.ts`) carries a
  whitelist of metrics (`{{fire.runwayMonths}}`, `{{netWorth.totalEUR}}`, …) whose values are
  formatted server-side from the calculator snapshot. The model writes tokens; the app renders the
  values. A statement containing **raw digits outside a token is dropped** — never relabelled, so a
  fabricated personal number can't reach the screen under any label.
- **Citations are validated against the context's id space** — the strategic snapshot id, the calc
  sources (`netWorth.v1`, …), the `profile.v1` calculator and the assumption row ids. Unknown
  citations are stripped; a Verified/Calculated statement left uncited is dropped. Metric tokens
  auto-attach their provenance to the statement.
- **If nothing survives validation, the answer fails closed** (nothing journaled, an honest error
  shown).
- The profile the model sees is the non-sensitive summary (region, FIRE planning, **age** — derived
  by the versioned `profile.v1` calculator from the `birthDate` assumption, never by the model).
- **Decision questions get scenario tokens.** The strategic snapshot carries the
  standard scenario set ([calculators](calculators.md#scenario-engine-scenariots)); the
  context exposes each diff as metrics (`{{scenario.N.netWorthDeltaEUR}}`,
  `{{scenario.N.runwayYearsAfter}}`, `{{scenario.N.oneOffTaxEUR}}`,
  `{{scenario.N.spreadTaxSavingEUR}}`, …) plus a summary block with each scenario's label,
  irreversibility and exclusions. The ids are **positional on purpose** — the scenario keys embed
  fact ids, which never cross the no-raw-dump boundary. So "should I sell the apartment?" is
  answered by comparing deterministic counterfactuals, gated by the same manual-review lock.

## Decision journal

Every recommendation worth keeping is saved (see [`decisions`](data-model.md)):

```
Decision { question, answer, assumptions, calculatorSnapshotIds, chosenAction, requiresManualReview, reviewedAt }
```

This lets you later ask *"why did I decide not to sell SMH in June?"* and get the exact numbers,
assumptions and reasoning you had at the time. As built, the answer is pinned by a single
`snapshotId` (every calculator output in one strategic snapshot shares one id) **plus** the
embedded `context` jsonb — the exact serialized input and rendered metric values the model saw —
so the evidence stays immutable even if the same-day snapshot row is later replaced (see
[data-model](data-model.md)).

## Manual-review lock

For irreversible / scary actions — sell a property, quit the job, sell a large ETF position,
pension withdrawal — the app may **not** sound certain. The recommendation is held:

> *"This recommendation requires manual review before becoming an action."*

`requiresManualReview` on the Decision gates it. The point is that the app is never allowed to be
glib about decisions you can't take back.

**As built** the lock has a deterministic half the model cannot argue away:
`src/ai/manualReview.ts` gates **every** sale / job-exit / withdrawal-shaped question (a keyword
gate can't price "sell VVSM" against the €100k threshold, so it over-gates by design — an extra
review is cheap, a missed one isn't), and the server stores
`gate(question) OR answer.requiresManualReview`. The UI holds the exact sentence above in a
banner until `markReviewed` — a once-only, atomic unlock that records the chosen action.

## Review analyst — *not* a proactive advisor

Renamed deliberately from "proactive advisor": **less exciting, more trustworthy.** It runs on a
**schedule** (monthly), not in real time:

- web research happens **only inside the review**
- scenario re-evaluation (did anything material change?)
- **no noisy market alerts** — nothing like "semiconductor valuations look stretched" pinging you
  between reviews

A review may raise the status to "Review soon" with sourced reasoning. It never interrupts you
with a market take.

### What the monthly review actually watches

Beyond portfolio/scenario change, the review is a **regulatory & legislation watch** for your
profile:

- **Tax-law / financial-regulation changes** — ES national + Cataluña IRPF scales, savings/general
  bands, rental taxation, wealth/solidarity tax, pension rules — and **announced, not-yet-effective
  ("coming") reforms**, so you get a heads-up before they land.
- **Re-verifying the versioned tax tables** (`taxES.es-cat.YYYY`, plus the wealth-tax
  tables `taxIP.es-cat.YYYY` riding in the same `review.taxTables`) against current law. If they've
  drifted, the review **proposes** a versioned config bump via **Structured Outputs** — a schema-
  constrained suggestion, **never auto-applied** (the deterministic `data_quality` year-rollover flag
  is the cheaper, no-AI floor that catches the same drift between reviews).
- **A monthly reassurance digest.** Even when nothing changed, the review says so —
  *"checked X, Y, Z; nothing material changed; tables current as of …"*. This is a **pulled,
  scheduled** digest, not a real-time push, so it stays inside principle #5: the firewall bans
  real-time alerts, not a calm monthly confirmation you opted into.
- A digest may carry a **recommendation** — always labelled **Judgment**, cited to its sources,
  saved to the decision journal, and **manual-review-gated** for irreversible actions. The review
  proposes; you decide. **A recommendation is only permitted when a deterministic
  trigger fired** ([calculators](calculators.md#recommendation-triggers-recommendationtriggersts)):
  the fired triggers ride in the review brief (`review.triggers`), and validation drops any
  recommendation made while the list is empty — fail-closed, including for stored
  snapshots. No trigger ⇒ no recommendation; the model can never originate one from browsing the
  portfolio.

To stay relevant without breaking the data boundary, the review is tailored by a **non-sensitive
profile summary** (e.g. "Cataluña resident; broad ETFs + a semiconductor ETF; two rentals; a
pension; planning FIRE") — never raw accounts. Removing the provider key disables the review's external
web/LLM research entirely.

### As built

The cron sidecar hits `/api/cron/review` on the 1st of each month;
`src/server/review.ts` orchestrates (mirroring `ask.ts`: injectable deps, the clock at the
boundary, no throws). One review per month — re-hits are no-ops.

- **The cadence never depends on the provider.** Every review first computes its
  deterministic floor: `materialChange` against the **previous review's** pinned snapshot
  summary ("did anything material change since I last reviewed?") plus the tax-table
  version on record. A missing key, a provider error or a report that dies
  in validation all degrade the row to `scope: "deterministic"` with the reason in
  `llm_error` — the month is always covered, honestly labelled.
- **The review context is the Ask context plus a review block** (`src/ai/reviewContext.ts`):
  month, the material-change result, the tax-table version under verification, and the
  non-sensitive profile brief. `buildAskContext` remains the only serialization boundary,
  so the no-raw-dump guarantee is inherited.
- **Two id spaces, two validation rules** (`src/ai/reviewSchema.ts`): the *digest* and the
  *recommendation* are about the user, so the Ask rules apply verbatim (figures only via
  `{{metric}}` tokens, citations from the context's id space, offenders dropped, empty ⇒
  fall back to the deterministic floor). *Findings* and the *tax-table verdict* are about
  the law, so raw figures are fine — but every claim needs an external web source URL:
  unsourced findings are dropped, an unsourced `current`/`drifted` verdict is weakened to
  `unverified` (claims only ever get weaker), and a malformed `proposedVersion` is nulled.
- **A surviving recommendation is journaled as a Decision** (`question: "Monthly review
  YYYY-MM — recommendation"`) and gated exactly like an Ask answer — the deterministic
  keyword gate ORs over the model's flag — so it shows up in `/ask`'s journal with the
  manual-review banner.
- **Web research happens only inside the review**: the review request is the only one in
  the app carrying the provider's web-search tool ([architecture](architecture.md#ai-provider-abstraction)).
- The reviews page renders the report: digest with labels and rendered metric values, the
  regulatory watch with source links and "announced" badges, the tax-table verdict (a
  proposed bump is shown as a proposal — applying it stays a human, in-repo act), and a
  "review soon" chip when `suggestsReview` is set. No push, no notification — you see it
  when you look (`checks` keeps anchoring "you last checked …").

### The accountability loop — advice that gets measured

The honest version of "a gestor who makes money when I make money" is a gestor whose advice is
**measured**. Every monthly review closes the loop on the decision journal:

- **Decision outcome tracking is part of the deterministic floor.** Each review re-evaluates
  every journaled decision with the pure `decisionOutcome` calculator
  ([calculators](calculators.md#decision-outcomes-decisionoutcomets)): the decision's
  pinned snapshot summary vs the current snapshot — Δ net worth, Δ runway, status then → now.
  The outcomes (a full `CalcResult`) and this month's **fired triggers** are pinned on the
  review row (`outcomes`, `fired_triggers`) in **both scopes** — a journaled recommendation
  from month N shows its measured outcome in month N+1's review even on the deterministic floor.
- **"Decisions revisited" in the digest** — two layers, two labels. The deltas are
  **Calculated** and rendered from the pinned outcomes; the analyst's read on them is a
  **Judgment** section (`decisionsRevisited` in the report) under the existing validation
  rules: the measured deltas ride in as positional `decision.N.*` metric tokens (raw decision
  ids never cross the boundary), statements with typed digits or unknown tokens are dropped,
  and **no journaled decision ⇒ the section is forced empty**. Drop-only — a read that dies in
  validation costs the voice, never the measurement.
- **Track record on the ask page** — every journaled answer shown with what happened since, beside
  it in the decision journal: measured live against today's computed state (Δ net worth, runway and
  status then → now). The app's advice becomes auditable the same way its numbers already are.
  The fine print states the attribution honestly: the deltas reflect everything since, not the
  decision alone. (The monthly review still pins the same measurement per row.)
- **The full pipeline, wired**: a trigger fires (deterministic) → the scenario engine
  quantifies the fix (Calculated) → the review's voice takes a side (Judgment, gated, journaled)
  → the next review re-grades it. Structurally capped at **one recommendation per monthly
  review** (`reviews.decisionId` stays singular on purpose). Between reviews the system never
  pushes opinions; and a month with no fired trigger says so on the record — the pinned empty
  trigger list renders as *"No triggers fired this month — nothing to recommend"*: informative
  silence, not absence.

## The picture — the standing reassurance narrative

The page the user opens when anxious: `/picture`, a calm, verbose "here is your situation and
why you can relax" essay, linked quietly from the home status screen. Pull-first like everything
else — it sits there; it never pushes.

- **A third instance of the voice pattern.** Ask answers questions, the review reports monthly,
  the picture *stands*. Same machinery: `buildPictureContext` (`src/ai/pictureContext.ts`)
  delegates to `buildAskContext` — the one serialization boundary — and appends the
  **`picture.v1` ratio metrics** (bucket shares of net worth, spend vs the safe draw, headroom,
  coarse runway; `src/calc/picture.ts`). Every percentage the narrative shows is deterministic;
  the model never derives a ratio.
- **Validation is the Ask rules verbatim**, delegated statement-for-statement to
  `validateAnswer` (`src/ai/pictureSchema.ts`): unknown tokens, typed digits and uncited
  verified/calculated statements are dropped. One extra rule: the narrative is sectioned, and a
  **digit in a heading drops the whole section** (headings can't carry tokens, so any digit
  there is a smuggled number). Nothing surviving ⇒ fail closed to the floor.
- **The psychological framing is invited — and always a Judgment.** The brief explicitly allows
  the reading the page exists for ("anxiety tracks the visible cash share, not the balance
  sheet"; what "enough" means) under the Judgment label, phrased as opinion. Not a decision
  channel: no recommendations, no action items, no urgency language, no market opinions.
- **Cadence: promotion + refresh.** `runPicture` (`src/server/picture.ts`) runs after **every**
  strategic-snapshot promotion — the daily update *and* every user intent (quick logs,
  assumptions, manage edits, setup, event realisation, via `intentTransaction` in
  `src/server/quicklog.ts`, after the transaction commits; the picture never blocks or fails a
  logged fact) — and on the page's refresh button (`force`, appended as a new row — latest
  wins, rows are never edited). Two deterministic gates bound the provider calls: idempotent
  per snapshot row, and (because user intents replace the same-day snapshot row) regenerate
  only when the pictured month rolled or `materialChange` fires against the latest picture's
  pinned summary — routine logs never spend a model call, a pile-moving one refreshes the
  story immediately. The request is Ask-shaped (no web tools), with a longer output bound.
- **Deterministic floor, like the review.** A missing key, a provider error or
  a narrative that dies in validation all save a `scope: "deterministic"` row with the reason;
  the `picture.v1` ratios and the snapshot summary are pinned on **every** row, so the page
  always renders something calm and true — even keyless, even offline.

## The quick-log parser — the fourth client (input, not analysis)

The natural-language quick-log on `/log` (see [input.md](input.md)) is the fourth instance of
the voice pattern, and the most constrained:

- **The tightest context of all.** Ask/review/picture receive calculator JSON; the parser
  receives **only the text the user just typed** (`src/ai/quicklogContext.ts` — the input is
  literally `{ text }`, asserted in `src/tests/unit/quicklogParse.test.ts`). No entity
  catalogue crosses the boundary: the model transcribes a *mention* ("VWCE", "the bank") and
  the server resolves it locally against names/tickers/ISINs.
- **Transcription is proven, not trusted** (`src/ai/quicklogSchema.ts`): every extracted span
  must appear verbatim in the input, and a normalized number must carry exactly the digits of
  its span — so the model structurally cannot originate a figure. Resolution failures and
  missing essentials become clarify questions, never guesses; dates resolve server-side; the
  one multiplication (quantity × price) is server-side decimal math.
- **It proposes; the human confirms; the forms' own validation re-applies.** The confirm card
  renders from the resolved struct only, and confirmation posts through the same quick-log
  actions as the manual forms — same Zod schemas, same in-transaction checks, one snapshot.
  No key / provider failure leave the manual forms untouched
  (`getQuicklogClient` gates at the factory, like the other three).

## Provider

Behind `src/ai/*`. The model needs **Structured Outputs** (schema-constrained proposals) and a
**web-search tool** (in-review research only). The concrete provider / model is recorded once, in
[architecture](architecture.md#ai-provider-abstraction) — not here, and not in the product design
(principles #13).
