import { db } from "@/server/db";
import {
  accounts,
  assumptions,
  holdings,
  plannedEvents,
  properties,
} from "@/server/db/schema";
import { PageHeader, PageShell } from "../ui";
import { ManageForms } from "./manage-forms";
import type { PLANNED_EVENT_TYPES } from "@/shared/setup";

export const dynamic = "force-dynamic";

// /manage — the slow-fact half of input (the ledger half lives on /log):
// add-later accounts/holdings/properties, assumption edits, planned events
// and their explicit realisation, and the soft-close flows.
export default async function ManagePage() {
  const [allAccounts, allHoldings, allProperties, allEvents, allAssumptions] =
    await Promise.all([
      db.select().from(accounts),
      db.select().from(holdings),
      db.select().from(properties),
      db.select().from(plannedEvents),
      db.select().from(assumptions),
    ]);

  const liveAccounts = allAccounts.filter((account) => !account.disposedAt);
  const liveHoldings = allHoldings.filter((holding) => !holding.disposedAt);
  const liveProperties = allProperties.filter((property) => !property.disposedAt);
  const openEvents = allEvents.filter((event) => !event.realisedAt);
  const accountNameById = new Map(liveAccounts.map((a) => [a.id, a.name]));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PageShell narrow>
      <PageHeader title="Your setup" />
      <p className="-mt-6 mb-10 max-w-xl text-sm italic leading-6 text-[var(--ink-soft)]">
        The slow-moving facts: accounts, holdings, properties, assumptions and
        planned events. Disposals soft-close — nothing is ever deleted. Each
        change recomputes the strategic snapshot.
      </p>
      <ManageForms
        accounts={liveAccounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          openingAsOf: account.openingAsOf,
        }))}
        holdings={liveHoldings.map((holding) => ({
          id: holding.id,
          label: holding.ticker ?? holding.name,
          name: holding.name,
          isin: holding.isin,
          accountName: accountNameById.get(holding.accountId) ?? "?",
        }))}
        properties={liveProperties.map((property) => ({
          id: property.id,
          name: property.name,
          value: property.value,
          valuedAt: property.valuedAt,
          rentMonthly: property.rentMonthly,
          isPrimaryResidence: property.isPrimaryResidence,
        }))}
        events={openEvents.map((event) => ({
          id: event.id,
          type: event.type as (typeof PLANNED_EVENT_TYPES)[number],
          date: event.date,
          amount: event.amount,
          probability: event.probability,
          includedInBaseCase: event.includedInBaseCase,
        }))}
        assumptions={allAssumptions.map((assumption) => ({
          key: assumption.key,
          value: assumption.value,
          dateValue: assumption.dateValue,
          lastReviewedAt: assumption.lastReviewedAt,
        }))}
        today={today}
      />
    </PageShell>
  );
}
