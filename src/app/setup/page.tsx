import { redirect } from "next/navigation";
import { loadFacts } from "@/server/facts";
import { BrandLogo, Masthead, PageShell } from "../ui";
import { SetupWizard } from "./wizard";

export const dynamic = "force-dynamic";

// First-run onboarding: enter the opening baseline (accounts, holdings + lots,
// properties, mortgages, assumptions) without scripts. Create-only — on a
// database that already has data this page steps aside (and the server commit
// independently refuses, behind an advisory lock).
export default async function SetupPage() {
  let hasData = false;
  let loadError: string | null = null;
  try {
    const bundle = await loadFacts();
    hasData = bundle.facts.accounts.length > 0;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <PageShell narrow className="py-20 text-center">
        <Masthead />
        <div className="mt-14 flex justify-center">
          <BrandLogo />
        </div>
        <h1 className="font-display mt-12 text-4xl">Setup</h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[var(--ink-soft)]">
          Could not reach the database. Set{" "}
          <code className="border border-[var(--hairline)] px-1">DATABASE_URL</code>{" "}
          and run{" "}
          <code className="border border-[var(--hairline)] px-1">npm run db:migrate</code>{" "}
          first.
        </p>
        <p className="fine-print mt-4">{loadError}</p>
      </PageShell>
    );
  }

  if (hasData) {
    redirect("/");
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <PageShell>
      <Masthead />
      <div className="mt-12">
        <div className="eyebrow">First run</div>
        <h1 className="font-display mt-2 text-4xl sm:text-5xl">
          Set the opening baseline
        </h1>
        <p className="mt-4 max-w-2xl text-sm italic leading-7 text-[var(--ink-soft)]">
          Everything from here on is logged as <em>changes</em> — this is the
          one time you enter balances. Big round figures are fine: the app
          thinks in years and percent, not euros. One commit at the end writes
          it all and computes your first snapshot.
        </p>
      </div>
      <div className="mt-10">
        <SetupWizard today={today} />
      </div>
    </PageShell>
  );
}
