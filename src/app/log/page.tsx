import { db } from "@/server/db";
import { accounts, holdings } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { PageHeader, PageShell } from "../ui";
import { NlLog } from "./nl-log";
import { QuickLogForms } from "./quick-log-forms";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const [allAccounts, allHoldings] = await Promise.all([
    db.select().from(accounts),
    db.select().from(holdings),
  ]);
  const nlStatus = getServerEnv().OPENAI_API_KEY
    ? ("ok" as const)
    : ("no-key" as const);
  const activeAccounts = allAccounts.filter((account) => !account.disposedAt);
  const activeHoldings = allHoldings.filter((holding) => !holding.disposedAt);
  const pensions = activeAccounts.filter((account) => account.type === "pension");

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PageShell narrow>
      <PageHeader title="Quick-log" />
      <p className="-mt-6 mb-10 max-w-xl text-sm italic leading-6 text-[var(--ink-soft)]">
        Append a verified fact to the ledger. Each successful entry recomputes
        the strategic snapshot; existing history is never edited.
      </p>
      <NlLog status={nlStatus} />
      <QuickLogForms
        accounts={activeAccounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
        }))}
        holdings={activeHoldings.map((holding) => ({
          id: holding.id,
          label: holding.ticker ?? holding.name,
        }))}
        pensions={pensions.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
        }))}
        today={today}
        thisMonth={today.slice(0, 7)}
      />
    </PageShell>
  );
}
