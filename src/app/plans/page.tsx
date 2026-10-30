import Link from "next/link";
import { loadOverview } from "@/server/overview";
import { PLAN_TYPES, planLabel } from "@/shared/plans";
import { completePlanAction, savePlanAction } from "../actions";
import { ActionForm, Submit } from "../ActionForm";
import { Done, eur, Field, formatDate, Header } from "../ui";

export const dynamic = "force-dynamic";

type Plan = Awaited<ReturnType<typeof loadOverview>>["plans"][number];

function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <>
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="fields-2">
        <Field label="What">
          <select name="type" className="input" defaultValue={plan?.type ?? "house_purchase"}>
            {PLAN_TYPES.map((type) => (
              <option key={type} value={type}>
                {planLabel(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Roughly when">
          <input name="date" type="date" className="input" defaultValue={plan && !plan.timingUnknown ? plan.date : ""} />
        </Field>
        <Field label="Rough amount (€)">
          <input
            name="amount"
            className="input"
            inputMode="decimal"
            defaultValue={plan && !plan.amountTBD ? Number(plan.amount) : ""}
          />
        </Field>
      </div>
      <div className="fields-2">
        <label className="check">
          <input type="checkbox" name="timingUnknown" defaultChecked={plan?.timingUnknown} /> Timing unknown
        </label>
        <label className="check">
          <input type="checkbox" name="amountTBD" defaultChecked={plan?.amountTBD} /> Amount not known yet
        </label>
      </div>
      <Field label="Context">
        <textarea name="note" className="input" rows={2} defaultValue={plan?.note ?? ""} placeholder="Financing, conditions, who's involved" />
      </Field>
    </>
  );
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const o = await loadOverview();
  return (
    <main className="page">
      <Header />
      <p className="small" style={{ margin: "4px 0 0" }}>
        <Link href="/">← Overview</Link>
      </p>
      <Done message={done} />
      <h1>Plans</h1>
      <p className="lead">
        Big changes you expect. They go into the export as context for a decision conversation and never change your
        numbers. When one happens, record the real change, then close the plan.
      </p>
      {o.plans.map((plan) => (
        <details key={plan.id} className="card card-pad" style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>
              <strong>{plan.label}</strong>{" "}
              <span className="muted">· {plan.timingUnknown ? "timing unknown" : formatDate(plan.date)}</span>
              {plan.note && <span className="row-sub" style={{ display: "block" }}>{plan.note}</span>}
            </span>
            <span className="num">{plan.amountTBD ? "TBD" : eur(plan.amount)}</span>
          </summary>
          <div style={{ marginTop: 14 }}>
            <ActionForm action={savePlanAction}>
              <PlanFields plan={plan} />
              <div>
                <Submit>Save plan</Submit>
              </div>
            </ActionForm>
            <ActionForm action={completePlanAction} confirm={`Close the ${plan.label.toLowerCase()} plan?`}>
              <input type="hidden" name="id" value={plan.id} />
              <div style={{ marginTop: 10 }}>
                <Submit className="btn btn-small">It happened / drop it</Submit>
              </div>
            </ActionForm>
          </div>
        </details>
      ))}
      <h2>Add a plan</h2>
      <ActionForm action={savePlanAction} className="card card-pad">
        <PlanFields />
        <div>
          <Submit>Add plan</Submit>
        </div>
      </ActionForm>
    </main>
  );
}
