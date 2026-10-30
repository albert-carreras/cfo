import Link from "next/link";
import { dec } from "@/calc/money";
import { loadOverview } from "@/server/overview";
import { saleBasisAction, taxPaidAction, undoTaxPaidAction, voidSaleAction } from "../actions";
import { ActionForm, Submit } from "../ActionForm";
import { Done, eur, Field, formatDate, Header, today, unitsText } from "../ui";

export const dynamic = "force-dynamic";

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const o = await loadOverview();
  return (
    <main className="page">
      <Header />
      <p className="small" style={{ margin: "4px 0 0" }}>
        <Link href="/">← Overview</Link>
      </p>
      <Done message={done} />
      <h1>Tax on sales</h1>
      <p className="lead">
        Gains from selling investments are taxed in the next spring&apos;s return at Spain&apos;s savings rates (19% on
        the first €6,000, 21% to €50,000, 23% to €200,000, then 27% and 30%). Until a year is marked paid, its estimate
        is deducted from your net worth. Interest, dividends and older losses carried forward are not included.
      </p>
      {o.taxYears.length === 0 && <p className="muted">No sales recorded.</p>}
      {o.taxYears.map((year) => (
        <section key={year.year}>
          <h2>{year.year}</h2>
          <div className="card card-pad">
            <dl className="kv">
              <dt>Sold for</dt>
              <dd>{eur(year.proceedsEUR)}</dd>
              <dt>Net gain</dt>
              <dd>{eur(year.gainEUR)}</dd>
              <dt>Estimated tax</dt>
              <dd>
                <strong>{eur(year.taxEUR)}</strong>
              </dd>
              <dt>Due by</dt>
              <dd>{formatDate(year.dueBy)}</dd>
              <dt>Status</dt>
              <dd>
                {year.settled ? (
                  <span className="up">
                    Paid {formatDate(year.settled.paidAt)} ({eur(year.settled.amountEUR)})
                  </span>
                ) : (
                  "Not paid yet"
                )}
              </dd>
            </dl>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            {year.sales.map((sale) => (
              <div key={sale.id} className="row" style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>
                    {formatDate(sale.soldAt)} · {unitsText(sale.quantity)} {sale.holding}
                  </span>
                  <span className="row-value">{eur(sale.proceedsEUR)}</span>
                </div>
                <div className="row-sub">
                  {sale.costBasisEUR ? (
                    <>
                      Cost {eur(sale.costBasisEUR)} ({sale.costBasisSource === "manual" ? "entered" : "FIFO"}) ·{" "}
                      {dec(sale.gainEUR ?? 0).isNegative() ? "loss" : "gain"} {eur(dec(sale.gainEUR ?? 0).abs().toString())}
                    </>
                  ) : (
                    <span className="stale">Cost basis unknown: not in the estimate</span>
                  )}
                </div>
                <details className="more">
                  <summary>Fix this sale</summary>
                  <div className="fields-2">
                    <ActionForm action={saleBasisAction}>
                      <input type="hidden" name="saleId" value={sale.id} />
                      <Field label="What these units cost (€)">
                        <input
                          name="costBasisEUR"
                          className="input"
                          inputMode="decimal"
                          defaultValue={sale.costBasisEUR ? Number(sale.costBasisEUR) : ""}
                          required
                        />
                      </Field>
                      <div>
                        <Submit className="btn btn-small">Save cost</Submit>
                      </div>
                    </ActionForm>
                    <ActionForm action={voidSaleAction} confirm="Remove this sale from the tax estimate? Balances stay as they are.">
                      <input type="hidden" name="saleId" value={sale.id} />
                      <p className="muted small" style={{ margin: 0 }}>
                        Recorded by mistake? This takes it out of the estimate only. Fix any balance it changed by
                        updating that balance.
                      </p>
                      <div>
                        <Submit className="btn btn-small btn-danger">Remove from estimate</Submit>
                      </div>
                    </ActionForm>
                  </div>
                </details>
              </div>
            ))}
          </div>

          {year.settled ? (
            <ActionForm action={undoTaxPaidAction} className="small" confirm={`Unmark ${year.year} as paid?`}>
              <input type="hidden" name="year" value={year.year} />
              <div style={{ marginTop: 8 }}>
                <Submit className="link-btn">Unmark as paid</Submit>
              </div>
            </ActionForm>
          ) : (
            <details className="more">
              <summary>Mark {year.year} as paid</summary>
              <ActionForm action={taxPaidAction} className="card card-pad">
                <input type="hidden" name="year" value={year.year} />
                <div className="fields-2">
                  <Field label="Amount paid (€)">
                    <input
                      name="amountEUR"
                      className="input"
                      inputMode="decimal"
                      defaultValue={Number(year.taxEUR)}
                      required
                    />
                  </Field>
                  <Field label="Paid on">
                    <input name="paidAt" type="date" className="input" max={today()} defaultValue={today()} required />
                  </Field>
                  <Field label="Paid from">
                    <select name="fromAccountId" className="input" defaultValue="">
                      <option value="">Leave balances alone</option>
                      {o.accounts
                        .filter((a) => a.type !== "pension")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <div>
                  <Submit>Mark paid</Submit>
                </div>
              </ActionForm>
            </details>
          )}
        </section>
      ))}
    </main>
  );
}
