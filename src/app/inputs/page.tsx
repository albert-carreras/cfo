import Link from "next/link";
import { loadOverview } from "@/server/overview";
import { PLANNING_INPUTS } from "@/shared/inputs";
import { inputsAction } from "../actions";
import { ActionForm, Submit } from "../ActionForm";
import { dec } from "@/calc/money";
import { Done, eur, Field, formatDate, Header } from "../ui";

export const dynamic = "force-dynamic";

export default async function InputsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const o = await loadOverview();
  const fire = o.snapshot.fire.value;
  return (
    <main className="page">
      <Header />
      <p className="small" style={{ margin: "4px 0 0" }}>
        <Link href="/">← Overview</Link>
      </p>
      <Done message={done} />
      <h1>Spending</h1>
      <div className="card card-pad">
        <dl className="kv">
          <dt>Cash + investments, after tax due</dt>
          <dd>{eur(fire.availableEUR)}</dd>
          <dt>Safe to spend per month</dt>
          <dd>{eur(fire.safeMonthlySpendEUR)}</dd>
          <dt>You spend per month</dt>
          <dd>{eur(fire.monthlySpendEUR)}</dd>
          <dt>Room left</dt>
          <dd className={fire.fits === false ? "down" : undefined}>{eur(fire.headroomEUR)}</dd>
          <dt>Lasts with zero growth</dt>
          <dd>{fire.runwayYears === null ? "—" : `${fire.runwayYears} years`}</dd>
        </dl>
      </div>
      <h2>Inputs</h2>
      <ActionForm action={inputsAction} className="card card-pad">
        {PLANNING_INPUTS.map((input) => {
          const row = o.inputs[input.key];
          const current = row?.value ?? "";
          const shown = !current
            ? ""
            : input.kind === "date"
              ? current
              : input.key === "safeWithdrawalRate"
                ? `${dec(current).times(100).toString()}%`
                : dec(current).toString();
          return (
            <div key={input.key}>
              <input type="hidden" name={`current-${input.key}`} value={current ?? ""} />
              <Field
                label={input.label}
                help={
                  <>
                    {input.help}
                    {row && ` Last set ${formatDate(row.lastReviewedAt)}.`}
                  </>
                }
              >
                <input
                  name={`value-${input.key}`}
                  className="input"
                  type={input.kind === "date" ? "date" : "text"}
                  inputMode={input.kind === "date" ? undefined : "decimal"}
                  defaultValue={shown}
                />
              </Field>
            </div>
          );
        })}
        <label className="check">
          <input type="checkbox" name="reconfirm" /> These are still right (marks them reviewed today)
        </label>
        <div>
          <Submit>Save</Submit>
        </div>
      </ActionForm>
    </main>
  );
}
