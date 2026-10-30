import Link from "next/link";
import { FRESHNESS_DAYS } from "@/calc/config/freshness";
import { dec } from "@/calc/money";
import { listActivity, loadOverview, loadSeries } from "@/server/overview";
import { Confirmed, Done, eur, formatDate, Header, NetWorthChart, priceText, signedEur, targetHref, unitsText } from "./ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const { done } = await searchParams;
  let overview: Awaited<ReturnType<typeof loadOverview>>;
  try {
    overview = await loadOverview();
  } catch (error) {
    return (
      <main className="page">
        <Header active="/" />
        <p className="alert alert-bad">
          The record is unavailable: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }
  const [series, activity] = await Promise.all([
    loadSeries(),
    listActivity(overview.names, 5),
  ]);
  const o = overview;
  const nw = o.snapshot.netWorth.value;
  const fire = o.snapshot.fire.value;
  const items = o.snapshot.attention.value.items;

  // The chart: the last year of daily points, ending on today's live figure.
  const yearAgo = new Date(Date.parse(o.asOf) - 365 * 86_400_000).toISOString().slice(0, 10);
  const points = [
    ...series.filter((p) => p.asOf >= yearAgo && p.asOf < o.asOf),
    { asOf: o.asOf, totalEUR: Number(nw.totalEUR) },
  ];
  const monthStart = `${o.asOf.slice(0, 7)}-01`;
  const lastMonth = series.filter((p) => p.asOf < monthStart).at(-1);
  const monthDelta = lastMonth ? dec(nw.totalEUR).minus(lastMonth.totalEUR) : null;

  if (o.accounts.length === 0 && o.properties.length === 0) {
    return (
      <main className="page">
        <Header active="/" />
        <h1>Nothing recorded yet</h1>
        <p className="lead">Add your accounts, investments and property once. After that you only record what changes.</p>
        <Link href="/change?do=add" className="btn btn-primary">
          Add your first account
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      <Header active="/" />
      <Done message={done} />

      <section className="hero">
        <div className="hero-label">Net worth · {formatDate(o.asOf)}</div>
        <div className="hero-value num">{eur(nw.totalEUR)}</div>
        {monthDelta && (
          <div className="hero-delta">
            <span className={monthDelta.isNegative() ? "down" : "up"}>{signedEur(monthDelta.toString())}</span>{" "}
            since the end of last month
          </div>
        )}
        <NetWorthChart points={points} />
      </section>

      <div className="actions">
        <Link href="/change" className="btn btn-primary">
          Something happened
        </Link>
        <Link href="/change?do=values" className="btn">
          Update balances
        </Link>
      </div>

      <h2>Needs you</h2>
      <div className="card attention">
        {items.length === 0 ? (
          <div className="all-good">All good. Nothing needs you right now.</div>
        ) : (
          items.map((item) => (
            <Link key={item.id} href={targetHref(item.target)} className="row">
              <span style={{ display: "flex" }}>
                <span className={`dot ${item.level === "high" ? "high" : ""}`} aria-hidden="true" />
                <span className="row-main">
                  <span className="row-title">{item.title}</span>
                  {item.detail && <span className="row-sub" style={{ display: "block" }}>{item.detail}</span>}
                </span>
              </span>
              <span className="faint" aria-hidden="true">›</span>
            </Link>
          ))
        )}
      </div>

      <h2>Summary</h2>
      <div className="card">
        <SummaryRow label="Cash" value={nw.cashEUR} sub="Bank, savings and broker cash" />
        <SummaryRow label="Investments" value={nw.investmentsEUR} sub="At today's prices" />
        <SummaryRow label="Pension" value={nw.pensionEUR} sub="Locked until retirement" />
        <SummaryRow label="Property" value={nw.propertyEquityEUR} sub="Your share, after mortgages" />
        {dec(nw.otherAssetsEUR).greaterThan(0) && <SummaryRow label="Other assets" value={nw.otherAssetsEUR} />}
        {dec(nw.debtEUR).greaterThan(0) && <SummaryRow label="Debt" value={nw.debtEUR} sub="Mortgages are already netted from property" />}
        {dec(nw.taxDueEUR).greaterThan(0) && (
          <Link href="/tax" className="row">
            <span className="row-main">
              <span className="row-title">Tax to keep aside</span>
              <span className="row-sub" style={{ display: "block" }}>Estimated on this year&apos;s sales</span>
            </span>
            <span className="row-value">−{eur(nw.taxDueEUR)}</span>
          </Link>
        )}
        <div className="row row-total">
          <span>Net worth</span>
          <span className="row-value">{eur(nw.totalEUR)}</span>
        </div>
      </div>

      <h2>Spending</h2>
      <Link href="/inputs" className="card card-pad" style={{ display: "block", textDecoration: "none" }}>
        {fire.safeMonthlySpendEUR && fire.monthlySpendEUR ? (
          <>
            <div>
              You spend <strong className="num">{eur(fire.monthlySpendEUR)}</strong>/month. Cash and investments can
              safely pay <strong className="num">{eur(fire.safeMonthlySpendEUR)}</strong>/month{" "}
              {fire.fits ? <span className="up">✓</span> : <span className="down">(over)</span>}
            </div>
            <div className="row-sub" style={{ marginTop: 4 }}>
              With no growth at all they would last {fire.runwayYears} years. Pension and property are not counted.
            </div>
          </>
        ) : (
          <div>Set your monthly spending to see what you can safely spend.</div>
        )}
      </Link>

      <h2>What you own</h2>
      <div className="card">
        {o.accounts.length > 0 && <div className="group-head">Accounts</div>}
        {o.accounts.map((account) => (
          <div key={account.id}>
            <Link href={`/item/account/${account.id}`} className="row">
              <span className="row-main">
                <span className="row-title">{account.name}</span>
                <span className="row-sub" style={{ display: "block" }}>
                  {account.typeLabel} ·{" "}
                  <Confirmed
                    date={account.confirmedAt}
                    asOf={o.asOf}
                    limitDays={account.type === "pension" ? FRESHNESS_DAYS.pension : FRESHNESS_DAYS.cash}
                  />
                </span>
              </span>
              <span className="row-value">
                {eur(account.holdings.length ? account.totalEUR : account.cashEUR)}
              </span>
            </Link>
            {account.holdings.map((h) => (
              <Link key={h.id} href={`/item/holding/${h.id}`} className="row row-indent">
                <span className="row-main">
                  <span className="row-title">{h.label}</span>
                  <span className="row-sub" style={{ display: "block" }}>
                    {unitsText(h.units)} × {h.priced ? priceText(h.priceEUR) : <span className="down">no price</span>}
                    {h.gainEUR && (
                      <>
                        {" · "}
                        <span className={dec(h.gainEUR).isNegative() ? "down" : "up"}>{signedEur(h.gainEUR)}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="row-value">{eur(h.valueEUR)}</span>
              </Link>
            ))}
            {account.holdings.length > 0 && !dec(account.cashEUR).isZero() && (
              <div className="row row-indent">
                <span className="row-sub">Cash</span>
                <span className="row-value small">{eur(account.cashEUR)}</span>
              </div>
            )}
          </div>
        ))}
        {o.properties.length > 0 && <div className="group-head">Property</div>}
        {o.properties.map((p) => (
          <Link key={p.id} href={`/item/property/${p.id}`} className="row">
            <span className="row-main">
              <span className="row-title">{p.name}</span>
              <span className="row-sub" style={{ display: "block" }}>
                {eur(p.valueEUR)}
                {p.ownershipPct !== "100" && ` · ${p.ownershipPct}% yours`}
                {dec(p.mortgageEUR).greaterThan(0) && ` · mortgage ${eur(p.mortgageEUR)}`} ·{" "}
                <Confirmed date={p.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.property} />
              </span>
            </span>
            <span className="row-value">{eur(p.equityEUR)}</span>
          </Link>
        ))}
        {o.liabilities.length > 0 && <div className="group-head">Debt</div>}
        {o.liabilities.map((l) => (
          <Link key={l.id} href={`/item/debt/${l.id}`} className="row">
            <span className="row-main">
              <span className="row-title">{l.name}</span>
              <span className="row-sub" style={{ display: "block" }}>
                <Confirmed date={l.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.debt} />
              </span>
            </span>
            <span className="row-value">−{eur(l.balanceEUR)}</span>
          </Link>
        ))}
        {o.otherAssets.length > 0 && <div className="group-head">Other</div>}
        {o.otherAssets.map((a) => (
          <Link key={a.id} href={`/item/other/${a.id}`} className="row">
            <span className="row-main">
              <span className="row-title">{a.name}</span>
              <span className="row-sub" style={{ display: "block" }}>
                {a.includeInNetWorth ? "Counted in net worth" : "Not counted"}
              </span>
            </span>
            <span className="row-value">{eur(a.valueEUR)}</span>
          </Link>
        ))}
      </div>
      <p className="small" style={{ marginTop: 8 }}>
        <Link href="/change?do=add">Add an account, investment, property or debt</Link>
      </p>

      <h2>Plans</h2>
      <div className="card">
        {o.plans.length === 0 && <div className="row muted">No plans recorded.</div>}
        {o.plans.map((plan) => (
          <Link key={plan.id} href="/plans" className="row">
            <span className="row-main">
              <span className="row-title">{plan.label}</span>
              <span className="row-sub" style={{ display: "block" }}>
                {plan.timingUnknown ? "Timing unknown" : formatDate(plan.date)}
                {plan.note && ` · ${plan.note}`}
              </span>
            </span>
            <span className="row-value">{plan.amountTBD ? "TBD" : eur(plan.amount)}</span>
          </Link>
        ))}
      </div>
      <p className="small" style={{ marginTop: 8 }}>
        Plans are context for decisions. They never change the numbers above. <Link href="/plans">Edit plans</Link>
      </p>

      <h2>Recent activity</h2>
      <div className="card">
        {activity.length === 0 && <div className="row muted">Nothing yet.</div>}
        {activity.map((entry) => (
          <div key={entry.id} className="row">
            <span className="row-main">
              <span className="row-title">{entry.title}</span>
              {entry.note && <span className="row-sub" style={{ display: "block" }}>{entry.note}</span>}
            </span>
            <span className="row-value small muted">{formatDate(entry.asOf)}</span>
          </div>
        ))}
      </div>
      <p className="small" style={{ marginTop: 8 }}>
        <Link href="/activity">All activity</Link>
      </p>
    </main>
  );
}

function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="row">
      <span className="row-main">
        <span className="row-title">{label}</span>
        {sub && <span className="row-sub" style={{ display: "block" }}>{sub}</span>}
      </span>
      <span className="row-value">{eur(value)}</span>
    </div>
  );
}
