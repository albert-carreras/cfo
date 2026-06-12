import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";

// --- Column helpers ---

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

// Money / prices / FX / quantities are exact `numeric` (kept as strings in JS,
// computed via decimal.js in src/calc/money.ts). Never a float column.
const money = (name: string) => numeric(name);

// --- Enums ---

export const accountTypeEnum = pgEnum("account_type", [
  "bank",
  "broker",
  "pension",
  "manual",
]);

export const movementTypeEnum = pgEnum("movement_type", [
  "deposit",
  "withdraw",
  "buy",
  "sell",
  "transfer",
  "dividend",
  "fee",
  "expense",
]);

export const liabilityTypeEnum = pgEnum("liability_type", ["mortgage"]);

export const plannedEventTypeEnum = pgEnum("planned_event_type", [
  "house_purchase",
  "property_sale",
  "job_exit",
  "pension_withdrawal",
  "rental_start",
  "inheritance",
]);

export const snapshotKindEnum = pgEnum("snapshot_kind", ["strategic", "internal"]);

// Which kind of asset a revaluation row re-anchors. Accounts are
// pension statements; properties are appraisals superseding the opening
// `properties.value`; liabilities are mortgage-balance statements superseding
// the opening `liabilities.balance`. Holdings keep their own (price-feed) path.
export const revaluationAssetEnum = pgEnum("revaluation_asset_type", [
  "account",
  "property",
  "liability",
]);

// --- Facts (Verified) ---

export const accounts = pgTable("accounts", {
  id: id(),
  type: accountTypeEnum("type").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  // The dated opening baseline: current cash = openingCash + movements since openingAsOf.
  openingCash: money("opening_cash").notNull().default("0"),
  openingAsOf: date("opening_as_of").notNull(),
  disposedAt: timestamp("disposed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const holdings = pgTable(
  "holdings",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    isin: text("isin").notNull(),
    ticker: text("ticker"),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("EUR"),
    // Baseline quantity; buy/sell movements move it thereafter.
    openingQuantity: money("opening_quantity").notNull().default("0"),
    openingAsOf: date("opening_as_of").notNull(),
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("holdings_account_idx").on(t.accountId)],
);

// Structure only — consumed by the tax engine, unused by the other calculators.
export const taxLots = pgTable(
  "tax_lots",
  {
    id: id(),
    holdingId: text("holding_id")
      .notNull()
      .references(() => holdings.id),
    buyDate: date("buy_date").notNull(),
    quantity: money("quantity").notNull(),
    price: money("price").notNull(),
    fees: money("fees").notNull().default("0"),
    fxRate: money("fx_rate").notNull().default("1"),
    costBasisEUR: money("cost_basis_eur").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tax_lots_holding_idx").on(t.holdingId)],
);

export const properties = pgTable("properties", {
  id: id(),
  name: text("name").notNull(),
  value: money("value").notNull(),
  purchasePrice: money("purchase_price"),
  ownershipPct: money("ownership_pct").notNull().default("100"),
  rentMonthly: money("rent_monthly").notNull().default("0"),
  costsMonthly: money("costs_monthly").notNull().default("0"),
  isPrimaryResidence: boolean("is_primary_residence").notNull().default(false),
  emotionalValue: integer("emotional_value"),
  // No market price for an apartment — these are periodic manual revaluations,
  // which data_quality checks against a quarterly cadence.
  valuedAt: date("valued_at").notNull(),
  disposedAt: timestamp("disposed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const liabilities = pgTable("liabilities", {
  id: id(),
  type: liabilityTypeEnum("type").notNull(),
  propertyId: text("property_id").references(() => properties.id),
  accountId: text("account_id").references(() => accounts.id),
  rate: money("rate"),
  balance: money("balance").notNull(),
  payment: money("payment"),
  disposedAt: timestamp("disposed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const assumptions = pgTable(
  "assumptions",
  {
    id: id(),
    key: text("key").notNull(),
    // Numeric assumptions (rates, returns…) use `value`; date-typed ones
    // (birthDate, pension access…) use `dateValue`. Exactly one is set.
    value: money("value"),
    dateValue: date("date_value"),
    conservativeValue: money("conservative_value"),
    optimisticValue: money("optimistic_value"),
    source: text("source"),
    lastReviewedAt: date("last_reviewed_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assumptions_key_idx").on(t.key),
    check(
      "assumptions_value_shape",
      sql`(${t.value} is null) <> (${t.dateValue} is null)`,
    ),
  ],
);

// Forecasts, not facts — consumed only by the scenario engine.
export const plannedEvents = pgTable("planned_events", {
  id: id(),
  type: plannedEventTypeEnum("type").notNull(),
  date: date("date").notNull(),
  amount: money("amount").notNull(),
  probability: money("probability").notNull().default("1"),
  includedInBaseCase: boolean("included_in_base_case").notNull().default(false),
  realisedAt: timestamp("realised_at", { withTimezone: true }),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Dated value statements — the re-anchor path for assets whose value
// is periodically STATED rather than derived (a pension statement, mirroring
// the property `valuedAt` pattern). Append-only like the ledger: asset value =
// latest revaluation + movements since its date (the opening-baseline rule,
// re-applied). Generic (assetType + assetId) so later phases can reuse it;
// today only `account` (pension) rows are written.
export const revaluations = pgTable(
  "revaluations",
  {
    id: id(),
    assetType: revaluationAssetEnum("asset_type").notNull(),
    assetId: text("asset_id").notNull(),
    value: money("value").notNull(),
    valuedAt: date("valued_at").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("revaluations_asset_idx").on(t.assetType, t.assetId, t.valuedAt),
    check("revaluations_value_not_negative", sql`${t.value} >= 0`),
  ],
);

// --- The append-only movement ledger (the thing you feed) ---

export const movements = pgTable(
  "movements",
  {
    id: id(),
    type: movementTypeEnum("type").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    holdingId: text("holding_id").references(() => holdings.id),
    quantity: money("quantity"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    occurredAt: date("occurred_at").notNull(),
    note: text("note"),
    // A correction is a NEW row pointing at the one it supersedes. Rows are
    // never edited or deleted.
    correctsId: text("corrects_id").references(
      (): AnyPgColumn => movements.id,
    ),
    // Both legs of an own-account transfer (withdraw on the source +
    // transfer on the destination) share one group id, written atomically by
    // the quick-log transfer path — so a transfer cannot create or destroy
    // money. Null for every single-leg movement.
    transferGroupId: text("transfer_group_id"),
    // Forecast → fact lineage: set when a movement is written by realising a
    // planned event, so the resulting ledger rows stay queryable from the
    // forecast they realised. Null for ordinary movements.
    plannedEventId: text("planned_event_id").references(() => plannedEvents.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("movements_account_idx").on(t.accountId),
    index("movements_transfer_group_idx").on(t.transferGroupId),
    index("movements_occurred_idx").on(t.occurredAt),
    uniqueIndex("movements_corrects_unique_idx")
      .on(t.correctsId)
      .where(sql`${t.correctsId} is not null`),
    check("movements_amount_positive", sql`${t.amount} > 0`),
    check("movements_currency_eur", sql`${t.currency} = 'EUR'`),
    check(
      "movements_holding_quantity_shape",
      sql`(
        (${t.type} in ('buy', 'sell') and ${t.holdingId} is not null and ${t.quantity} > 0)
        or
        (${t.type} not in ('buy', 'sell') and ${t.holdingId} is null and ${t.quantity} is null)
      )`,
    ),
    check(
      "movements_correction_not_self",
      sql`${t.correctsId} is null or ${t.correctsId} <> ${t.id}`,
    ),
  ],
);

// One figure per month you log — the source of truth for FIRE / runway.
// Append-only: latest row per month wins; older rows retained for audit.
export const monthlySpend = pgTable(
  "monthly_spend",
  {
    id: id(),
    month: text("month").notNull(), // "YYYY-MM"
    amount: money("amount").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("monthly_spend_month_idx").on(t.month),
    check("monthly_spend_amount_positive", sql`${t.amount} > 0`),
    check(
      "monthly_spend_month_format",
      sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
);

// --- Feeds (daily history from the update job) ---

export const marketPrices = pgTable(
  "market_prices",
  {
    id: id(),
    isin: text("isin").notNull(),
    price: money("price").notNull(),
    currency: text("currency").notNull().default("EUR"),
    asOf: date("as_of").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("market_prices_isin_asof_idx").on(t.isin, t.asOf)],
);

// rate = EUR per 1 unit of `quote` (so amount_in_quote * rate = amount_in_eur).
export const fxRates = pgTable(
  "fx_rates",
  {
    id: id(),
    base: text("base").notNull().default("EUR"),
    quote: text("quote").notNull(),
    rate: money("rate").notNull(),
    asOf: date("as_of").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fx_rates_quote_asof_idx").on(t.quote, t.asOf)],
);

// --- Computed state & history (Calculated) ---

export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    kind: snapshotKindEnum("kind").notNull(),
    status: text("status").notNull(),
    result: jsonb("result").notNull(),
    asOf: date("as_of").notNull(),
    dedupeKey: text("dedupe_key"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("snapshots_dedupe_key_idx")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index("snapshots_latest_idx").on(t.kind, t.computedAt, t.createdAt),
  ],
);

// --- Decision journal (Judgment) ---

// One row per Ask answer. Append-only in spirit: question/answer/context are
// never edited; only the human-review fields (chosenAction, reviewedAt) are
// ever set, once, via markReviewed. `context` embeds the EXACT serialized
// AskContext (metrics with server-rendered values included) the model saw, so
// the decision's evidence stays immutable even if the same-day snapshot row is
// later replaced by the dedupe upsert (the FK cascades across that id rewrite).
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    question: text("question").notNull(),
    answer: jsonb("answer").notNull(), // validated AskAnswer (labelled statements + citations)
    context: jsonb("context").notNull(), // the AskContext sent to the model — immutable provenance
    assumptions: jsonb("assumptions").notNull(), // the assumption rows shown to the model
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => snapshots.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    requiresManualReview: boolean("requires_manual_review")
      .notNull()
      .default(false),
    chosenAction: text("chosen_action"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    model: text("model").notNull(), // provenance of the Judgment (e.g. "gpt-5.5")
    createdAt: createdAt(),
  },
  (t) => [index("decisions_created_idx").on(t.createdAt)],
);

// --- Monthly reviews (Judgment + Calculated) ---

// One row per scheduled monthly review, append-only. `scope` records how far
// the review could go: "full" = the analyst ran (digest + regulatory watch +
// tax-table verification), "deterministic" = no key / a
// provider failure limited it to the no-AI floor (material change + tax-table
// flag). Either way the month is covered — the cadence never depends on the
// provider. `summary` embeds the snapshot summary the NEXT review compares
// against; `context`/`report` embed exactly what the model saw and what
// survived validation (immutable evidence, like decisions).
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    month: text("month").notNull(), // "YYYY-MM" — one review per month
    scope: text("scope").notNull(), // "full" | "deterministic"
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => snapshots.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    summary: jsonb("summary").notNull(), // SnapshotSummary — next review's baseline
    materialChange: jsonb("material_change").notNull(), // MaterialChangeValue vs the last review
    taxTableVersion: text("tax_table_version").notNull(),
    report: jsonb("report"), // validated ReviewReport (null when deterministic-only)
    context: jsonb("context"), // the exact ReviewContext sent (null when no model ran)
    model: text("model"),
    llmError: text("llm_error"), // why a full review fell back to deterministic
    decisionId: text("decision_id").references(() => decisions.id), // journaled recommendation
    // Written once with the row, never edited (append-only like the
    // rest): the measured outcome of every journaled decision at review time
    // (CalcResult<DecisionOutcomesValue>) and the deterministic recommendation
    // triggers that fired this month. Both survive a provider outage — they
    // are part of the deterministic floor, not the analyst. Null only on
    // legacy rows.
    outcomes: jsonb("outcomes"),
    firedTriggers: jsonb("fired_triggers"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_month_idx").on(t.month),
    index("reviews_created_idx").on(t.createdAt),
    check(
      "reviews_month_format",
      sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check("reviews_scope_valid", sql`${t.scope} in ('full', 'deterministic')`),
  ],
);

// --- The picture (standing reassurance narrative, Judgment + Calculated) ---

// One row per (re)generation of the standing "/picture" narrative, append-only
// — latest wins, a refresh is a new row, never an edit. Generated when a
// strategic snapshot is promoted and on manual refresh. `scope` mirrors
// reviews: "full" = the voice ran and survived validation, "deterministic" =
// no key / a provider failure left the deterministic floor.
// `summary` + `derived` pin the Calculated evidence (the floor renders from
// them in both scopes); `narrative`/`context` embed what survived validation
// and exactly what the model saw. The same-day snapshot dedupe upsert may
// rewrite the snapshot row this points at — the pinned jsonb stays immutable
// (same accepted behavior as decisions/reviews).
export const pictures = pgTable(
  "pictures",
  {
    id: id(),
    scope: text("scope").notNull(), // "full" | "deterministic"
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => snapshots.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    summary: jsonb("summary").notNull(), // SnapshotSummary at generation time
    derived: jsonb("derived").notNull(), // CalcResult<PictureValue> — the floor
    narrative: jsonb("narrative"), // validated PictureNarrative (null when deterministic)
    context: jsonb("context"), // the exact PictureContext sent (null when no model ran)
    model: text("model"),
    llmError: text("llm_error"), // why a full narrative fell back to deterministic
    createdAt: createdAt(),
  },
  (t) => [
    index("pictures_snapshot_idx").on(t.snapshotId),
    index("pictures_created_idx").on(t.createdAt),
    check("pictures_scope_valid", sql`${t.scope} in ('full', 'deterministic')`),
  ],
);

// --- App-level switches (not facts — not in assumptions) ---

export const settings = pgTable(
  "settings",
  {
    id: id(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("settings_key_idx").on(t.key)],
);

// --- Repeat-check log ---

// Append-only: one row each time the calm home is looked at, with the status
// shown. Powers "you last checked … — nothing material changed since" and is
// the anchor the monthly digest will summarise from. Never updated or
// deleted.
export const checks = pgTable(
  "checks",
  {
    id: id(),
    statusAtCheck: text("status_at_check").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("checks_checked_at_idx").on(t.checkedAt)],
);
