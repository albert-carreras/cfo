import Link from "next/link";
import { FRESHNESS_DAYS } from "@/calc/config/freshness";
import { dec } from "@/calc/money";
import { listActivity, loadOverview, loadSeries } from "@/server/overview";
import { XpIcon } from "./icons";
import {
  Badge,
  Confirmed,
  Done,
  eur,
  formatDate,
  Header,
  isStale,
  NetWorthChart,
  priceText,
  signedEur,
  targetHref,
  unitsText,
} from "./ui";

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

  const highCount = items.filter((item) => item.level === "high").length;
  const counts = [
    plural(o.accounts.length, "account"),
    o.properties.length > 0 && plural(o.properties.length, "property", "properties"),
    o.liabilities.length > 0 && plural(o.liabilities.length, "debt"),
  ]
    .filter(Boolean)
    .join(" · ");
  const needLine =
    items.length === 0 ? "Nothing needs you" : `${items.length} ${items.length === 1 ? "thing needs" : "things need"} you`;
  const marquee = `CFO *** ${formatDate(o.asOf)} *** ${needLine} *** ${counts} *** Every number verified or calculated ***`;

  // Equalizer sliders for the summary: each slider's height is its value
  // against the largest one. Shape only; the € figures are the rows next to it.
  const mix = [
    { short: "Cash", value: nw.cashEUR },
    { short: "Inv", value: nw.investmentsEUR },
    { short: "Pens", value: nw.pensionEUR },
    { short: "Prop", value: nw.propertyEquityEUR },
    ...(dec(nw.otherAssetsEUR).greaterThan(0) ? [{ short: "Other", value: nw.otherAssetsEUR }] : []),
    ...(dec(nw.debtEUR).greaterThan(0) ? [{ short: "Debt", value: nw.debtEUR, owed: true }] : []),
    ...(dec(nw.taxDueEUR).greaterThan(0) ? [{ short: "Tax", value: nw.taxDueEUR, owed: true }] : []),
  ];
  const mixMax = Math.max(...mix.map((m) => Math.max(0, Number(m.value))));
  const level = (value: string) => (mixMax > 0 ? Math.max(0, Number(value)) / mixMax : 0);

  const spend = fire.monthlySpendEUR ? Number(fire.monthlySpendEUR) : null;
  const safe = fire.safeMonthlySpendEUR ? Number(fire.safeMonthlySpendEUR) : null;
  const spendFill = spend != null && safe != null && safe > 0 ? Math.min(1, spend / safe) : 1;

  return (
    <main className="page page-wide">
      <Header
        active="/"
        marquee={marquee}
        stats={[
          {
            value: String(items.length),
            label: "need you",
            href: "#needs-title",
            tone: highCount > 0 ? "bad" : items.length > 0 ? "warn" : undefined,
          },
          { value: eur(nw.taxDueEUR), label: "tax aside", href: "/tax" },
        ]}
      />
      <Done message={done} />

      <div className="deck">
        <div className="deck-col">
          <section className="pane o-own" aria-labelledby="own-title">
            <h2 id="own-title" className="pane-title">
              <span>What you own</span>
            </h2>
            <div className="pane-body own-list">
              {o.accounts.length > 0 && <div className="own-group">Accounts</div>}
              {o.accounts.map((account) => {
                const limit = account.type === "pension" ? FRESHNESS_DAYS.pension : FRESHNESS_DAYS.cash;
                const stale = isStale(account.confirmedAt, limit, o.asOf);
                return (
                  <div key={account.id}>
                    <Link href={`/item/account/${account.id}`} className="own-row">
                      <XpIcon name="folder" className="own-icon" />
                      <span className="own-main">
                        <span className="own-name">{account.name}</span>
                        <span className="own-sub">
                          {account.typeLabel} · <Confirmed date={account.confirmedAt} asOf={o.asOf} limitDays={limit} />
                        </span>
                      </span>
                      <span className="own-side">
                        <span className="own-value">{eur(account.holdings.length ? account.totalEUR : account.cashEUR)}</span>
                        <Badge tone={stale ? "warn" : "good"}>{stale ? "Stale" : "Fresh"}</Badge>
                      </span>
                    </Link>
                    {account.holdings.map((h) => (
                      <Link key={h.id} href={`/item/holding/${h.id}`} className="own-row own-indent">
                        <XpIcon name="graph" className="own-icon" />
                        <span className="own-main">
                          <span className="own-name">{h.label}</span>
                          <span className="own-sub">
                            {unitsText(h.units)} × {h.priced ? priceText(h.priceEUR) : <span className="down">no price</span>}
                            {h.gainEUR && (
                              <>
                                {" · "}
                                <span className={dec(h.gainEUR).isNegative() ? "down" : "up"}>{signedEur(h.gainEUR)}</span>
                              </>
                            )}
                          </span>
                        </span>
                        <span className="own-side">
                          <span className="own-value">{eur(h.valueEUR)}</span>
                          {!h.priced && <Badge tone="bad">No price</Badge>}
                        </span>
                      </Link>
                    ))}
                    {account.holdings.length > 0 && !dec(account.cashEUR).isZero() && (
                      <div className="own-row own-indent own-cash">
                        <span className="own-main">
                          <span className="own-sub">Cash</span>
                        </span>
                        <span className="own-side">
                          <span className="own-value">{eur(account.cashEUR)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {o.properties.length > 0 && <div className="own-group">Property</div>}
              {o.properties.map((p) => {
                const stale = isStale(p.valuedAt, FRESHNESS_DAYS.property, o.asOf);
                return (
                  <Link key={p.id} href={`/item/property/${p.id}`} className="own-row">
                    <XpIcon name="home" className="own-icon" />
                    <span className="own-main">
                      <span className="own-name">{p.name}</span>
                      <span className="own-sub">
                        {eur(p.valueEUR)}
                        {p.ownershipPct !== "100" && ` · ${p.ownershipPct}% yours`}
                        {dec(p.mortgageEUR).greaterThan(0) && ` · mortgage ${eur(p.mortgageEUR)}`} ·{" "}
                        <Confirmed date={p.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.property} />
                      </span>
                    </span>
                    <span className="own-side">
                      <span className="own-value">{eur(p.equityEUR)}</span>
                      <Badge tone={stale ? "warn" : "good"}>{stale ? "Stale" : "Fresh"}</Badge>
                    </span>
                  </Link>
                );
              })}
              {o.liabilities.length > 0 && <div className="own-group">Debt</div>}
              {o.liabilities.map((l) => {
                const stale = isStale(l.valuedAt, FRESHNESS_DAYS.debt, o.asOf);
                return (
                  <Link key={l.id} href={`/item/debt/${l.id}`} className="own-row">
                    <XpIcon name="certificate" className="own-icon" />
                    <span className="own-main">
                      <span className="own-name">{l.name}</span>
                      <span className="own-sub">
                        <Confirmed date={l.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.debt} />
                      </span>
                    </span>
                    <span className="own-side">
                      <span className="own-value">−{eur(l.balanceEUR)}</span>
                      <Badge tone={stale ? "warn" : "good"}>{stale ? "Stale" : "Fresh"}</Badge>
                    </span>
                  </Link>
                );
              })}
              {o.otherAssets.length > 0 && <div className="own-group">Other</div>}
              {o.otherAssets.map((a) => (
                <Link key={a.id} href={`/item/other/${a.id}`} className="own-row">
                  <XpIcon name="briefcase" className="own-icon" />
                  <span className="own-main">
                    <span className="own-name">{a.name}</span>
                    <span className="own-sub">{a.includeInNetWorth ? "Counted in net worth" : "Not counted"}</span>
                  </span>
                  <span className="own-side">
                    <span className="own-value">{eur(a.valueEUR)}</span>
                    <Badge tone={a.includeInNetWorth ? "info" : "off"}>{a.includeInNetWorth ? "Counted" : "Not counted"}</Badge>
                  </span>
                </Link>
              ))}
            </div>
            <div className="pane-foot">
              <Link href="/change?do=add" className="wa-mini">
                + Add
              </Link>
              <span className="pane-foot-lcd">{counts}</span>
            </div>
          </section>
        </div>

        <div className="deck-col">
          <section className="pane o-worth" aria-labelledby="worth-title">
            <h2 id="worth-title" className="pane-title">
              <span>Net worth</span>
            </h2>
            <div className="pane-body pane-body-pad">
              <div className="lcd hero">
                <div className="lcd-head">
                  <span>As of {formatDate(o.asOf)}</span>
                  <span>EUR</span>
                </div>
                <div className="hero-value num">{eur(nw.totalEUR)}</div>
                {monthDelta && (
                  <div className="hero-delta">
                    <span className={monthDelta.isNegative() ? "down" : "up"}>{signedEur(monthDelta.toString())}</span>{" "}
                    since the end of last month
                  </div>
                )}
                <NetWorthChart points={points} />
              </div>
            </div>
          </section>

          <section className="pane o-needs" aria-labelledby="needs-title">
            <h2 id="needs-title" className="pane-title">
              <span>Needs you{items.length > 0 && ` (${items.length})`}</span>
            </h2>
            <div className="pane-body msgs">
              {items.length === 0 ? (
                <div className="msg">
                  <XpIcon name="success" className="msg-icon" />
                  <span className="msg-main">
                    <span className="msg-title">All good.</span>
                    <span className="msg-text">Nothing needs you right now.</span>
                  </span>
                </div>
              ) : (
                items.map((item, i) => (
                  <Link key={item.id} href={targetHref(item.target)} className="msg">
                    <XpIcon name={item.level === "high" ? "critical" : "alert"} className="msg-icon" />
                    <span className="msg-main">
                      <span className="msg-title">
                        {i + 1}. {item.title}
                      </span>
                      {item.detail && <span className="msg-text">{item.detail}</span>}
                    </span>
                    <span className="msg-go" aria-hidden="true">
                      »
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="pane o-activity" aria-labelledby="activity-title">
            <h2 id="activity-title" className="pane-title">
              <span>Recent activity</span>
            </h2>
            <div className="pane-body msgs">
              {activity.length === 0 && <div className="msg-empty">Nothing yet.</div>}
              {activity.map((entry) => (
                <div key={entry.id} className="msg">
                  <XpIcon name="information" className="msg-icon" />
                  <span className="msg-main">
                    <span className="msg-title">{entry.title}</span>
                    {entry.note && <span className="msg-text">{entry.note}</span>}
                  </span>
                  <span className="msg-time">{formatDate(entry.asOf)}</span>
                </div>
              ))}
            </div>
            <div className="pane-foot">
              <Link href="/activity" className="wa-mini">
                All activity
              </Link>
            </div>
          </section>
        </div>

        <div className="deck-col">
          <section className="pane o-summary" aria-labelledby="summary-title">
            <h2 id="summary-title" className="pane-title">
              <span>Summary</span>
            </h2>
            <div className="pane-body">
              <div className="eq-panel" aria-hidden="true">
                {mix.map((m) => (
                  <div key={m.short} className="eq-col">
                    <div className={`eq-track${"owed" in m ? " owed" : ""}`}>
                      <div className="eq-fill" style={{ height: `${Math.round(level(m.value) * 100)}%` }}>
                        <span className="eq-knob" />
                      </div>
                    </div>
                    <div className="eq-label">{m.short}</div>
                  </div>
                ))}
              </div>
              <div className="sum-rows">
                <SummaryRow label="Cash" value={nw.cashEUR} sub="Bank, savings and broker cash" />
                <SummaryRow label="Investments" value={nw.investmentsEUR} sub="At today's prices" />
                <SummaryRow label="Pension" value={nw.pensionEUR} sub="Locked until retirement" />
                <SummaryRow label="Property" value={nw.propertyEquityEUR} sub="Your share, after mortgages" />
                {dec(nw.otherAssetsEUR).greaterThan(0) && <SummaryRow label="Other assets" value={nw.otherAssetsEUR} />}
                {dec(nw.debtEUR).greaterThan(0) && (
                  <SummaryRow label="Debt" value={nw.debtEUR} sub="Mortgages are already netted from property" />
                )}
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
            </div>
          </section>

          <section className="pane o-spend" aria-labelledby="spend-title">
            <h2 id="spend-title" className="pane-title">
              <span>Spending</span>
            </h2>
            <div className="pane-body">
              {spend != null && safe != null ? (
                <>
                  <div className="lcd lcd-rows">
                    <div className="lcd-row">
                      <span>You spend</span>
                      <span>{eur(fire.monthlySpendEUR)}/mo</span>
                    </div>
                    <div className="lcd-row">
                      <span>Safe to spend</span>
                      <span>{eur(fire.safeMonthlySpendEUR)}/mo</span>
                    </div>
                    <div className={`vol${fire.fits ? "" : " over"}`} aria-hidden="true">
                      <span style={{ width: `${100 - Math.round(spendFill * 100)}%` }} />
                    </div>
                    <div className="lcd-status">{fire.fits ? "Fits" : "Over the safe level"}</div>
                  </div>
                  <p className="pane-note small">
                    Cash and investments only. With no growth at all they would last {fire.runwayYears} years. Pension
                    and property are not counted. <Link href="/inputs">Change spending</Link>
                  </p>
                </>
              ) : (
                <p className="pane-note small">
                  <Link href="/inputs">Set your monthly spending</Link> to see what you can safely spend.
                </p>
              )}
            </div>
          </section>

          <section className="pane o-plans" aria-labelledby="plans-title">
            <h2 id="plans-title" className="pane-title">
              <span>Plans</span>
            </h2>
            <div className="pane-body">
              {o.plans.length === 0 ? (
                <div className="msg-empty">No plans recorded.</div>
              ) : (
                <ol className="queue">
                  {o.plans.map((plan, i) => (
                    <li key={plan.id}>
                      <Link href="/plans">
                        <span className="queue-n">{i + 1}.</span>
                        <span className="queue-main">
                          <span className="queue-title">{plan.label}</span>
                          <span className="queue-sub">
                            {plan.timingUnknown ? "Timing unknown" : formatDate(plan.date)}
                            {plan.note && ` · ${plan.note}`}
                          </span>
                        </span>
                        <span className="queue-value">{plan.amountTBD ? "TBD" : eur(plan.amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
              <p className="pane-note small">Plans are context for decisions. They never change the numbers above.</p>
            </div>
            <div className="pane-foot">
              <Link href="/plans" className="wa-mini">
                Edit plans
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
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
