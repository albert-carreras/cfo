# Roadmap — what's left

Guiding rule: **the trust core must exist before the voice.** That order held: the deterministic
brain (ledger, calculators, status engine, market feed), the calm UI, and only then the voice
(Ask, the monthly Review analyst, the Picture) — everything described in the other docs is built
and behind `npm run test:ci`. This file tracks what is deliberately **not** built yet.

If you're looking for how the system works, read [principles.md](principles.md) and
[architecture.md](architecture.md); this page is only the backlog.

## Backlog

Deliberately unscheduled — each stays open until there's a reason to build it:

- **Tax-config DB table + editing UI** — the versioned tax tables ship as config-as-code
  (`src/calc/config/taxES.es-cat.*.ts`, selected by year via `config/taxRegistry.ts`), which keeps
  the calculators pure and the sources cited in-file. A `tax_config` DB table is deferred until
  there's a UI to edit the tables; the data model anticipates it
  (see [data-model.md](data-model.md)).
- **Audit logging & export/delete tooling** — the append-only ledger and snapshot provenance cover
  the movement history, but editable facts (accounts, properties, assumptions) have no audit
  trail, and there's no one-shot export/delete of all personal data
  (see [architecture.md](architecture.md)).
- **Import paths for holdings and lots** (broker CSV / paste) — initial setup and the quick-log
  are manual by design; bulk import is the missing convenience for portfolios with long lot
  histories (see [input.md](input.md)).
- **Remaining tax exclusions** — the tax card prints what it doesn't model
  (see [calculators.md](calculators.md)): ISGF (stated, not computed), detailed plusvalía (the
  flat 5% stays until the cadastral model earns its complexity), wash-sale homogeneity beyond the
  same holding, derived family minimums, the legacy 40% pre-2007 pension-lump-sum reduction,
  mortgage-interest & depreciation deductions on rentals, dividend/interest withholding (estimates
  run on net cash logged), the legal IP valuation basis, and the 25% dividend/interest cap on loss
  offsets.
- **Concentration look-through** — the concentration calculator classifies position / broker /
  real-estate / country exposure against versioned ceilings; looking *through* a world ETF to its
  sector weights (the tech-concentration question) is not modelled.
- **Property ROE refinements** — the property-yield calculator covers unlevered gross/net/real
  yields vs the assumed real ETF return; ROE with mortgage interest, a liquidity penalty and
  life-utility weighting stay open.
- **Cash-drag persistence** — the cash-drag recommendation trigger is instantaneous; "above the
  ceiling for M consecutive months" needs the snapshot history and is deferred.
- **Document vault + extraction** — statements and deeds as attached, parsed sources.
- **Open banking** (revisit deliberately) — read-only spend import is the difference between a
  system you maintain and a system that maintains distance for you. Keep saying no *knowingly*.
