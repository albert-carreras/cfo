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

  // Equalizer bars for the summary: each bar's height is its value against the
  // largest one. Shape only; the € figures are the rows underneath.
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
  const lit = (value: string) => {
    const v = Math.max(0, Number(value));
    if (mixMax <= 0 || v <= 0) return 0;
    return Math.max(1, Math.round((EQ_SEGMENTS * v) / mixMax));
  };

  const spend = fire.monthlySpendEUR ? Number(fire.monthlySpendEUR) : null;
  const safe = fire.safeMonthlySpendEUR ? Number(fire.safeMonthlySpendEUR) : null;
  const spendLit =
    spend != null && safe != null && safe > 0
      ? Math.min(SPEND_SEGMENTS, Math.round((SPEND_SEGMENTS * spend) / safe))
      : SPEND_SEGMENTS;

  return (
    <main className="page">
      <Done message={done} />

      <div className="status-strip">
        <span className={`led ${items.length === 0 ? "led-good" : highCount > 0 ? "led-bad" : "led-warn"}`} aria-hidden="true" />
        <span>{needLine}</span>
        <span className="strip-sep" aria-hidden="true">
          |
        </span>
        <span>As of {formatDate(o.asOf)}</span>
        <span className="strip-sep strip-wide" aria-hidden="true">
          |
        </span>
        <span className="strip-wide">{counts}</span>
        <Link href="/tax" className="strip-pill">
          <XpIcon name="calculator" />
          Tax aside {eur(nw.taxDueEUR)}
        </Link>
      </div>

      <div className="deck">
        <div className="deck-col">
          <section className="pane o-own" aria-labelledby="own-title">
            <div className="pane-tabs">
              <h2 id="own-title" className="pane-tab is-active">
                <XpIcon name="folder" />
                What you own
              </h2>
              <Link href="/change?do=add" className="pane-add">
                + Add
              </Link>
            </div>
            <div className="pane-body own-list">
              {o.accounts.length > 0 && <div className="own-group">Accounts</div>}
              {o.accounts.map((account) => {
                const limit = account.type === "pension" ? FRESHNESS_DAYS.pension : FRESHNESS_DAYS.cash;
                const stale = isStale(account.confirmedAt, limit, o.asOf);
                return (
                  <div key={account.id} className="own-node">
                    <Link href={`/item/account/${account.id}`} className="own-row">
                      <span className="own-gap" aria-hidden="true" />
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
                    {account.holdings.length > 0 && (
                      // A tree node, like Explorer's: the box shows or hides what the account holds.
                      <details open className="own-kids">
                        <summary className="own-exp" aria-label={`Investments in ${account.name}`} />
                        {account.holdings.map((h) => (
                          <Link key={h.id} href={`/item/holding/${h.id}`} className="own-row own-indent">
                            <span className="own-gap" aria-hidden="true" />
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
                        {!dec(account.cashEUR).isZero() && (
                          <div className="own-row own-indent own-cash">
                            <span className="own-main">
                              <span className="own-sub">Cash</span>
                            </span>
                            <span className="own-side">
                              <span className="own-value">{eur(account.cashEUR)}</span>
                            </span>
                          </div>
                        )}
                      </details>
                    )}
                  </div>
                );
              })}
              {o.properties.length > 0 && <div className="own-group">Property</div>}
              {o.properties.map((p) => {
                const stale = isStale(p.valuedAt, FRESHNESS_DAYS.property, o.asOf);
                return (
                  <Link key={p.id} href={`/item/property/${p.id}`} className="own-row">
                    <span className="own-gap" aria-hidden="true" />
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
                    <span className="own-gap" aria-hidden="true" />
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
                  <span className="own-gap" aria-hidden="true" />
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
          </section>
        </div>

        <div className="deck-col">
          <section className="pane o-worth" aria-labelledby="worth-title">
            <h2 id="worth-title" className="pane-title">
              Net worth
            </h2>
            <div className="pane-body pane-pad">
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
              Needs you
              {items.length > 0 && <span className="pane-count">{items.length}</span>}
            </h2>
            <div className="pane-body msgs">
              {items.length === 0 ? (
                <div className="msg">
                  <span className="msg-avatar">
                    <XpIcon name="success" />
                  </span>
                  <span className="msg-main">
                    <span className="msg-head">
                      <span className="msg-title">All good.</span>
                    </span>
                    <span className="msg-text">Nothing needs you right now.</span>
                  </span>
                </div>
              ) : (
                items.map((item) => (
                  <Link key={item.id} href={targetHref(item.target)} className="msg">
                    <span className="msg-avatar">
                      <XpIcon name={item.level === "high" ? "critical" : "alert"} />
                    </span>
                    <span className="msg-main">
                      <span className="msg-head">
                        <span className="msg-title">{item.title}</span>
                      </span>
                      {item.detail && <span className="msg-text">{item.detail}</span>}
                    </span>
                    <XpIcon name="go" className="msg-go" />
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="pane o-activity" aria-labelledby="activity-title">
            <h2 id="activity-title" className="pane-title">
              Recent activity
            </h2>
            <div className="pane-body msgs">
              {activity.length === 0 && <div className="msg-empty">Nothing yet.</div>}
              {activity.map((entry) => (
                <div key={entry.id} className="msg">
                  <span className="msg-avatar">
                    <XpIcon name="information" />
                  </span>
                  <span className="msg-main">
                    <span className="msg-head">
                      <span className="msg-title">{entry.title}</span>
                      <span className="msg-time">{formatDate(entry.asOf)}</span>
                    </span>
                    {entry.note && <span className="msg-text">{entry.note}</span>}
                  </span>
                </div>
              ))}
              <div className="pane-note small">
                <Link href="/activity">All activity</Link>
              </div>
            </div>
          </section>
        </div>

        <div className="deck-col">
          <section className="pane o-summary" aria-labelledby="summary-title">
            <h2 id="summary-title" className="pane-title">
              Summary
            </h2>
            <div className="pane-body">
              <div className="eq-panel" aria-hidden="true">
                {mix.map((m) => (
                  <div key={m.short} className="eq-col">
                    <div className={`eq-meter${"owed" in m ? " owed" : ""}`}>
                      {Array.from({ length: EQ_SEGMENTS }, (_, i) => (
                        <span key={i} className={i < lit(m.value) ? "on" : undefined} />
                      ))}
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
            <h2 id="spend-title" className="pane-title pane-title-play">
              Spending
            </h2>
            <div className="pane-body pane-pad">
              {spend != null && safe != null ? (
                <>
                  <div className="lcd now">
                    <div className="lcd-row now-main">
                      <span>You spend</span>
                      <span>{eur(fire.monthlySpendEUR)}/mo</span>
                    </div>
                    <div className="lcd-row now-sub">
                      <span>→ Safe to spend</span>
                      <span>{eur(fire.safeMonthlySpendEUR)}/mo</span>
                    </div>
                    <div className={`led-bar${fire.fits ? "" : " over"}`} aria-hidden="true">
                      {Array.from({ length: SPEND_SEGMENTS }, (_, i) => (
                        <span key={i} className={i < spendLit ? "on" : undefined} />
                      ))}
                    </div>
                    <div className={`now-status${fire.fits ? "" : " over"}`}>{fire.fits ? "Fits" : "Over the safe level"}</div>
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
            <h2 id="plans-title" className="pane-title pane-title-list">
              Plans
            </h2>
            <div className="pane-body pane-pad">
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
              <p className="pane-note small">
                Plans are context for decisions. They never change the numbers above. <Link href="/plans">Edit plans</Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

const EQ_SEGMENTS = 12;
const SPEND_SEGMENTS = 20;

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
