import Link from "next/link";
import { notFound } from "next/navigation";
import { FRESHNESS_DAYS } from "@/calc/config/freshness";
import { dec } from "@/calc/money";
import { loadOverview, type Overview } from "@/server/overview";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, OTHER_ASSET_CATEGORIES } from "@/shared/inputs";
import { addLotAction, closeItemAction, editItemAction, setValuesAction } from "../../../actions";
import { ActionForm, Submit } from "../../../ActionForm";
import { Confirmed, Done, eur, Field, formatDate, Header, priceText, signedEur, today, unitsText } from "../../../ui";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ kind, id }, { done }] = await Promise.all([params, searchParams]);
  const o = await loadOverview();
  const body = renderItem(kind, id, o);
  if (!body) notFound();
  return (
    <main className="page">
      <Header />
      <p className="small" style={{ margin: "4px 0 0" }}>
        <Link href="/">← Overview</Link>
      </p>
      <Done message={done} />
      {body}
    </main>
  );
}

function renderItem(kind: string, id: string, o: Overview) {
  if (kind === "account") {
    const account = o.accounts.find((row) => row.id === id);
    return account ? <AccountItem account={account} o={o} /> : null;
  }
  if (kind === "holding") {
    for (const account of o.accounts) {
      const holding = account.holdings.find((row) => row.id === id);
      if (holding) return <HoldingItem holding={holding} accountName={account.name} o={o} />;
    }
    return null;
  }
  if (kind === "property") {
    const property = o.properties.find((row) => row.id === id);
    return property ? <PropertyItem property={property} o={o} /> : null;
  }
  if (kind === "debt") {
    const debt = o.liabilities.find((row) => row.id === id);
    return debt ? <DebtItem debt={debt} o={o} /> : null;
  }
  if (kind === "other") {
    const asset = o.otherAssets.find((row) => row.id === id);
    return asset ? <OtherItem asset={asset} o={o} /> : null;
  }
  return null;
}

function SetValue({
  assetType,
  id,
  back,
  label,
  current,
}: {
  assetType: string;
  id: string;
  back: string;
  label: string;
  current: string;
}) {
  return (
    <ActionForm action={setValuesAction} className="card card-pad">
      <input type="hidden" name="back" value={back} />
      <div className="fields-2">
        <Field label={label}>
          <input
            name={`v:${assetType}:${id}`}
            className="input"
            inputMode="decimal"
            placeholder={String(Number(current))}
            required
          />
        </Field>
        <Field label="As of">
          <input name="asOf" type="date" className="input" max={today()} defaultValue={today()} required />
        </Field>
      </div>
      <div>
        <Submit>Save</Submit>
      </div>
    </ActionForm>
  );
}

function OtherAccounts({ o, except }: { o: Overview; except?: string }) {
  return (
    <>
      {o.accounts
        .filter((row) => row.id !== except && row.type !== "pension")
        .map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
    </>
  );
}

function AccountItem({ account, o }: { account: Overview["accounts"][number]; o: Overview }) {
  const back = `/item/account/${account.id}`;
  return (
    <>
      <h1>{account.name}</h1>
      <p className="lead">
        {account.typeLabel} ·{" "}
        <Confirmed
          date={account.confirmedAt}
          asOf={o.asOf}
          limitDays={account.type === "pension" ? FRESHNESS_DAYS.pension : FRESHNESS_DAYS.cash}
        />
      </p>
      <div className="card">
        <div className="row">
          <span>Cash</span>
          <span className="row-value">{eur(account.cashEUR)}</span>
        </div>
        {account.holdings.map((h) => (
          <Link key={h.id} href={`/item/holding/${h.id}`} className="row">
            <span>{h.label}</span>
            <span className="row-value">{eur(h.valueEUR)}</span>
          </Link>
        ))}
        {account.holdings.length > 0 && (
          <div className="row row-total">
            <span>Total</span>
            <span className="row-value">{eur(account.totalEUR)}</span>
          </div>
        )}
      </div>

      <h2>Set the cash balance</h2>
      <SetValue assetType="account" id={account.id} back={back} label="Cash balance now (€)" current={account.cashEUR} />

      <h2>Details</h2>
      <ActionForm action={editItemAction} className="card card-pad">
        <input type="hidden" name="kind" value="account" />
        <input type="hidden" name="id" value={account.id} />
        <div className="fields-2">
          <Field label="Name">
            <input name="name" className="input" defaultValue={account.name} required />
          </Field>
          <Field label="Type">
            <select name="type" className="input" defaultValue={account.type}>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACCOUNT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <Submit className="btn">Save details</Submit>
        </div>
      </ActionForm>

      <h2 id="close">Close this account</h2>
      {account.holdings.length > 0 ? (
        <p className="muted">It still holds investments. Sell or remove them first.</p>
      ) : (
        <ActionForm action={closeItemAction} className="card card-pad" confirm={`Close ${account.name}?`}>
          <input type="hidden" name="kind" value="account" />
          <input type="hidden" name="id" value={account.id} />
          {!dec(account.cashEUR).isZero() && (
            <Field
              label={`It still shows ${eur(account.cashEUR)}. What happened to it?`}
              help="If you already typed the other account's current balance, the money is counted there: pick the first option."
            >
              <select name="moveTo" className="input" defaultValue="">
                <option value="">Already counted elsewhere, or spent: set to €0</option>
                {o.accounts
                  .filter((row) => row.id !== account.id && row.type !== "pension")
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      Add it to {row.name} ({eur(row.cashEUR)} now)
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            It leaves the overview and stays in the activity log.
          </p>
          <div>
            <Submit className="btn btn-danger">Close account</Submit>
          </div>
        </ActionForm>
      )}
    </>
  );
}

function HoldingItem({
  holding,
  accountName,
  o,
}: {
  holding: Overview["accounts"][number]["holdings"][number];
  accountName: string;
  o: Overview;
}) {
  const back = `/item/holding/${holding.id}`;
  return (
    <>
      <h1>{holding.label}</h1>
      <p className="lead">
        {holding.name} · {accountName}
      </p>
      <div className="card card-pad">
        <dl className="kv">
          <dt>Units</dt>
          <dd>{unitsText(holding.units)}</dd>
          <dt>Price</dt>
          <dd>
            {holding.priced ? (
              <>
                {priceText(holding.priceEUR)} <span className="muted small">({formatDate(holding.priceAsOf!)})</span>
              </>
            ) : (
              <span className="down">no price yet: check the ticker</span>
            )}
          </dd>
          <dt>Value</dt>
          <dd>{eur(holding.valueEUR)}</dd>
          <dt>Cost basis (FIFO)</dt>
          <dd>{holding.costBasisEUR ? eur(holding.costBasisEUR) : "unknown"}</dd>
          {holding.gainEUR && (
            <>
              <dt>Gain if sold today</dt>
              <dd className={dec(holding.gainEUR).isNegative() ? "down" : "up"}>{signedEur(holding.gainEUR)}</dd>
            </>
          )}
          <dt>Units confirmed</dt>
          <dd>
            <Confirmed date={holding.confirmedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.units} bare />
          </dd>
        </dl>
      </div>
      <div className="actions">
        <Link href={`/change?do=sell&holding=${holding.id}`} className="btn btn-primary">
          Sold some
        </Link>
        <Link href={`/change?do=buy&holding=${holding.id}`} className="btn">
          Bought more
        </Link>
      </div>

      <h2>Correct the units</h2>
      <p className="muted small">Only if the count is wrong. Trades belong in &ldquo;Sold&rdquo; or &ldquo;Bought&rdquo;.</p>
      <SetValue assetType="holding" id={holding.id} back={back} label="Units you hold now" current={holding.units} />

      <h2>Purchases (cost basis)</h2>
      <div className="card">
        {holding.lots.length === 0 && <div className="row muted">None recorded, so gains can&apos;t be worked out.</div>}
        {holding.lots.map((lot) => (
          <div key={lot.id} className="row">
            <span>
              {formatDate(lot.buyDate)} · {unitsText(lot.quantity)} units
            </span>
            <span className="row-value">{eur(lot.costBasisEUR)}</span>
          </div>
        ))}
      </div>
      <details className="more">
        <summary>Add a purchase you already hold</summary>
        <ActionForm action={addLotAction} className="card card-pad">
          <input type="hidden" name="holdingId" value={holding.id} />
          <div className="fields-2">
            <Field label="Bought on">
              <input name="buyDate" type="date" className="input" max={today()} required />
            </Field>
            <Field label="Units">
              <input name="units" className="input" inputMode="decimal" required />
            </Field>
            <Field label="Total cost (€)">
              <input name="costEUR" className="input" inputMode="decimal" required />
            </Field>
          </div>
          <div>
            <Submit className="btn">Add purchase</Submit>
          </div>
        </ActionForm>
      </details>

      <h2>Details</h2>
      <ActionForm action={editItemAction} className="card card-pad">
        <input type="hidden" name="kind" value="holding" />
        <input type="hidden" name="id" value={holding.id} />
        <div className="fields-2">
          <Field label="Name">
            <input name="name" className="input" defaultValue={holding.name} required />
          </Field>
          <Field label="Ticker" help="Yahoo Finance symbol used for the daily price.">
            <input name="ticker" className="input" defaultValue={holding.ticker ?? ""} required />
          </Field>
        </div>
        <div>
          <Submit className="btn">Save details</Submit>
        </div>
      </ActionForm>

      <h2 id="close">Remove without a sale</h2>
      <ActionForm
        action={closeItemAction}
        className="card card-pad"
        confirm={`Remove ${holding.label} without recording a sale?`}
      >
        <input type="hidden" name="kind" value="holding" />
        <input type="hidden" name="id" value={holding.id} />
        <p className="muted small" style={{ margin: 0 }}>
          For a position that moved broker or never existed. If you sold it, use &ldquo;Sold some&rdquo; so the gain and
          tax are counted.
        </p>
        <div>
          <Submit className="btn btn-danger">Remove</Submit>
        </div>
      </ActionForm>
    </>
  );
}

function PropertyItem({ property, o }: { property: Overview["properties"][number]; o: Overview }) {
  const back = `/item/property/${property.id}`;
  return (
    <>
      <h1>{property.name}</h1>
      <p className="lead">
        <Confirmed date={property.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.property} />
      </p>
      <div className="card card-pad">
        <dl className="kv">
          <dt>Full value</dt>
          <dd>{eur(property.valueEUR)}</dd>
          <dt>Your share</dt>
          <dd>
            {property.ownershipPct}% = {eur(property.shareEUR)}
          </dd>
          {dec(property.mortgageEUR).greaterThan(0) && (
            <>
              <dt>Mortgage</dt>
              <dd>−{eur(property.mortgageEUR)}</dd>
            </>
          )}
          <dt>Your equity</dt>
          <dd>{eur(property.equityEUR)}</dd>
          <dt>Purchase price</dt>
          <dd>{property.purchasePrice ? eur(property.purchasePrice) : <span className="stale">not recorded</span>}</dd>
        </dl>
      </div>

      <h2>Update the value</h2>
      <SetValue assetType="property" id={property.id} back={back} label="Full value now (€)" current={property.valueEUR} />

      <h2>Details</h2>
      <ActionForm action={editItemAction} className="card card-pad">
        <input type="hidden" name="kind" value="property" />
        <input type="hidden" name="id" value={property.id} />
        <Field label="Name">
          <input name="name" className="input" defaultValue={property.name} required />
        </Field>
        <div className="fields-2">
          <Field label="Your share (%)">
            <input name="ownershipPct" className="input" inputMode="decimal" defaultValue={property.ownershipPct} required />
          </Field>
          <Field label="Purchase price (€)">
            <input name="purchasePrice" className="input" inputMode="decimal" defaultValue={property.purchasePrice ?? ""} />
          </Field>
          <Field label="Rent received / month (€)">
            <input name="rentMonthly" className="input" inputMode="decimal" defaultValue={Number(property.rentMonthly)} />
          </Field>
          <Field label="Costs / month (€)">
            <input name="costsMonthly" className="input" inputMode="decimal" defaultValue={Number(property.costsMonthly)} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" name="isPrimaryResidence" defaultChecked={property.isPrimaryResidence} /> This is my home
        </label>
        <div>
          <Submit className="btn">Save details</Submit>
        </div>
      </ActionForm>

      <h2 id="close">Sold it</h2>
      <ActionForm action={closeItemAction} className="card card-pad" confirm={`Record the sale of ${property.name}?`}>
        <input type="hidden" name="kind" value="property" />
        <input type="hidden" name="id" value={property.id} />
        <div className="fields-2">
          <Field label="Net proceeds (€)" help="Your share, after the mortgage is paid off and costs.">
            <input name="proceedsEUR" className="input" inputMode="decimal" required />
          </Field>
          <Field label="Money went to">
            <select name="toAccountId" className="input">
              <OtherAccounts o={o} />
              <option value="">Leave balances alone</option>
            </select>
          </Field>
          <Field label="Sold on">
            <input name="date" type="date" className="input" max={today()} defaultValue={today()} required />
          </Field>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          The property and its mortgage close. Tax on a property gain isn&apos;t estimated: ask your gestor.
        </p>
        <div>
          <Submit className="btn btn-danger">Record sale</Submit>
        </div>
      </ActionForm>
    </>
  );
}

function DebtItem({ debt, o }: { debt: Overview["liabilities"][number]; o: Overview }) {
  const back = `/item/debt/${debt.id}`;
  return (
    <>
      <h1>{debt.name}</h1>
      <p className="lead">
        {debt.propertyName ? `Mortgage on ${debt.propertyName} · ` : ""}
        <Confirmed date={debt.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.debt} />
      </p>
      <div className="card card-pad">
        <dl className="kv">
          <dt>Still owed</dt>
          <dd>{eur(debt.balanceEUR)}</dd>
          <dt>Rate</dt>
          <dd>{debt.rate ? `${dec(debt.rate).times(100).toString()}%` : "—"}</dd>
          <dt>Payment / month</dt>
          <dd>{eur(debt.payment)}</dd>
        </dl>
      </div>
      <h2>Update the balance</h2>
      <SetValue assetType="liability" id={debt.id} back={back} label="Still owed now (€)" current={debt.balanceEUR} />
      <h2>Details</h2>
      <ActionForm action={editItemAction} className="card card-pad">
        <input type="hidden" name="kind" value="debt" />
        <input type="hidden" name="id" value={debt.id} />
        <div className="fields-2">
          <Field label="Name">
            <input name="name" className="input" defaultValue={debt.name} required />
          </Field>
          <Field label="Rate" help="e.g. 2.6%">
            <input name="rate" className="input" defaultValue={debt.rate ? `${dec(debt.rate).times(100).toString()}%` : ""} />
          </Field>
          <Field label="Payment / month (€)">
            <input name="payment" className="input" inputMode="decimal" defaultValue={debt.payment ?? ""} />
          </Field>
        </div>
        <div>
          <Submit className="btn">Save details</Submit>
        </div>
      </ActionForm>
      <h2 id="close">Paid it off</h2>
      <ActionForm action={closeItemAction} className="card card-pad" confirm={`Mark ${debt.name} as repaid?`}>
        <input type="hidden" name="kind" value="debt" />
        <input type="hidden" name="id" value={debt.id} />
        <div className="fields-2">
          <Field label="Paid from">
            <select name="accountId" className="input" defaultValue="">
              <option value="">Leave balances alone</option>
              <OtherAccounts o={o} />
            </select>
          </Field>
          <Field label="Amount paid (€)">
            <input name="amountEUR" className="input" inputMode="decimal" defaultValue={Number(debt.balanceEUR)} />
          </Field>
        </div>
        <div>
          <Submit className="btn btn-danger">Mark repaid</Submit>
        </div>
      </ActionForm>
    </>
  );
}

function OtherItem({ asset, o }: { asset: Overview["otherAssets"][number]; o: Overview }) {
  const back = `/item/other/${asset.id}`;
  return (
    <>
      <h1>{asset.name}</h1>
      <p className="lead">
        {asset.includeInNetWorth ? "Counted in net worth" : "Not counted in net worth"} ·{" "}
        <Confirmed date={asset.valuedAt} asOf={o.asOf} limitDays={FRESHNESS_DAYS.otherAsset} />
      </p>
      <div className="card">
        <div className="row">
          <span>Value</span>
          <span className="row-value">{eur(asset.valueEUR)}</span>
        </div>
      </div>
      <h2>Update the value</h2>
      <SetValue assetType="other_asset" id={asset.id} back={back} label="Value now (€)" current={asset.valueEUR} />
      <h2>Details</h2>
      <ActionForm action={editItemAction} className="card card-pad">
        <input type="hidden" name="kind" value="other" />
        <input type="hidden" name="id" value={asset.id} />
        <div className="fields-2">
          <Field label="Name">
            <input name="name" className="input" defaultValue={asset.name} required />
          </Field>
          <Field label="Kind">
            <select name="category" className="input" defaultValue={asset.category}>
              {OTHER_ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" name="includeInNetWorth" defaultChecked={asset.includeInNetWorth} /> Count it in net worth
        </label>
        <Field label="Note">
          <input name="note" className="input" defaultValue={asset.note ?? ""} />
        </Field>
        <div>
          <Submit className="btn">Save details</Submit>
        </div>
      </ActionForm>
      <h2 id="close">Sold or gone</h2>
      <ActionForm action={closeItemAction} className="card card-pad" confirm={`Remove ${asset.name}?`}>
        <input type="hidden" name="kind" value="other" />
        <input type="hidden" name="id" value={asset.id} />
        <div className="fields-2">
          <Field label="Money went to">
            <select name="accountId" className="input" defaultValue="">
              <option value="">Nowhere / leave balances alone</option>
              <OtherAccounts o={o} />
            </select>
          </Field>
          <Field label="Amount (€)">
            <input name="amountEUR" className="input" inputMode="decimal" />
          </Field>
        </div>
        <div>
          <Submit className="btn btn-danger">Remove</Submit>
        </div>
      </ActionForm>
    </>
  );
}
