import Link from "next/link";
import { loadOverview, type Overview } from "@/server/overview";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, OTHER_ASSET_CATEGORIES } from "@/shared/inputs";
import {
  addAccountAction,
  addHoldingAction,
  addLiabilityAction,
  addOtherAssetAction,
  addPropertyAction,
  buyAction,
  moveAction,
  sellAction,
  setValuesAction,
} from "../actions";
import { ActionForm, Submit } from "../ActionForm";
import { eur, Field, Header, today, unitsText } from "../ui";

export const dynamic = "force-dynamic";

const CHOICES = [
  { key: "sell", title: "Sold an investment", text: "Units out, cash in, gain and tax worked out." },
  { key: "buy", title: "Bought an investment", text: "More of something you hold, or something new." },
  { key: "move", title: "Moved money", text: "Between two of your accounts." },
  { key: "values", title: "Update balances", text: "Type what your bank or broker shows now." },
  { key: "add", title: "Opened or got something", text: "New account, investment, property, debt." },
  { key: "close", title: "Closed or sold something else", text: "An account, property, debt or other asset." },
] as const;

type Choice = (typeof CHOICES)[number]["key"];

export default async function ChangePage({
  searchParams,
}: {
  searchParams: Promise<{ do?: string; what?: string; holding?: string }>;
}) {
  const params = await searchParams;
  const current = CHOICES.find((choice) => choice.key === params.do)?.key ?? null;
  const o = await loadOverview();

  return (
    <main className="page">
      <Header active="/change" />
      {current ? (
        <>
          <p className="small" style={{ margin: "4px 0 0" }}>
            <Link href="/change">← Something else happened</Link>
          </p>
          <h1 id="form">{CHOICES.find((c) => c.key === current)?.title}</h1>
          <ChoiceForm choice={current} o={o} what={params.what} holding={params.holding} />
        </>
      ) : (
        <>
          <h1>What happened?</h1>
          <p className="lead">Pick one. Each saves everything it implies in one go.</p>
          <div className="choices">
            {CHOICES.map((choice) => (
              <Link key={choice.key} href={`/change?do=${choice.key}`} className="choice">
                <strong>{choice.title}</strong>
                <span>{choice.text}</span>
              </Link>
            ))}
            <Link href="/tax" className="choice">
              <strong>Paid tax</strong>
              <span>Settle a year&apos;s tax on sales.</span>
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

function ChoiceForm({
  choice,
  o,
  what,
  holding,
}: {
  choice: Choice;
  o: Overview;
  what?: string;
  holding?: string;
}) {
  switch (choice) {
    case "sell":
      return <SellForm o={o} holding={holding} />;
    case "buy":
      return <BuyForm o={o} holding={holding} />;
    case "move":
      return <MoveForm o={o} />;
    case "values":
      return <ValuesForm o={o} />;
    case "add":
      return <AddForms o={o} what={what} />;
    case "close":
      return <CloseList o={o} />;
  }
}

function AccountOptions({ o, exclude }: { o: Overview; exclude?: (type: string) => boolean }) {
  return (
    <>
      {o.accounts
        .filter((account) => !exclude?.(account.type))
        .map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} · {eur(account.cashEUR)} cash now
          </option>
        ))}
    </>
  );
}

function SellForm({ o, holding }: { o: Overview; holding?: string }) {
  const holdings = o.accounts.flatMap((account) =>
    account.holdings.map((h) => ({ ...h, accountName: account.name })),
  );
  if (holdings.length === 0) return <p className="muted">No investments recorded.</p>;
  return (
    <ActionForm action={sellAction} className="card card-pad">
      <Field label="What did you sell?">
        <select name="holdingId" className="input" required defaultValue={holding}>
          {holdings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label} · {h.accountName} · {unitsText(h.units)} units
            </option>
          ))}
        </select>
      </Field>
      <div className="fields-2">
        <Field label="Units sold" help="Leave blank if you sold all of it.">
          <input name="units" className="input" inputMode="decimal" placeholder="All" />
        </Field>
        <Field label="Total received (€)" help="After fees. Several orders? Add them up.">
          <input name="proceedsEUR" className="input" inputMode="decimal" required placeholder="124,000" />
        </Field>
      </div>
      <div className="fields-2">
        <Field label="Date" help="The last sale, if there were several.">
          <input name="date" type="date" className="input" max={today()} defaultValue={today()} required />
        </Field>
        <Field label="Where is the money now?">
          <select name="to" className="input" defaultValue="same">
            <option value="same">Still in the broker account</option>
            <AccountOptions o={o} exclude={(type) => type === "pension"} />
            <option value="none">Leave balances alone (I&apos;ll update them myself)</option>
          </select>
        </Field>
      </div>
      <details className="more">
        <summary>Cost basis and note</summary>
        <div className="form-body">
          <Field
            label="What these units cost you (€)"
            help="Leave blank to use your recorded purchases, oldest first (FIFO), which is what Hacienda uses."
          >
            <input name="costBasisEUR" className="input" inputMode="decimal" />
          </Field>
          <Field label="Note">
            <input name="note" className="input" placeholder="Optional" />
          </Field>
        </div>
      </details>
      <div>
        <Submit>Record sale</Submit>
      </div>
    </ActionForm>
  );
}

function BuyForm({ o, holding }: { o: Overview; holding?: string }) {
  const holdings = o.accounts.flatMap((account) =>
    account.holdings.map((h) => ({ ...h, accountName: account.name })),
  );
  return (
    <ActionForm action={buyAction} className="card card-pad">
      <Field label="What did you buy?">
        <select name="holdingId" className="input" defaultValue={holding ?? (holdings.length ? holdings[0].id : "new")}>
          {holdings.map((h) => (
            <option key={h.id} value={h.id}>
              More {h.label} · {h.accountName}
            </option>
          ))}
          <option value="new">Something new…</option>
        </select>
      </Field>
      <div className="new-only fields-2">
        <Field label="In which account?">
          <select name="newAccountId" className="input">
            <AccountOptions o={o} exclude={(type) => type === "manual"} />
          </select>
        </Field>
        <Field label="Ticker" help="As on Yahoo Finance: VWCE.DE, CSPX.L, AAPL.">
          <input name="newTicker" className="input" autoCapitalize="characters" />
        </Field>
        <Field label="Name">
          <input name="newName" className="input" placeholder="Vanguard FTSE All-World" />
        </Field>
      </div>
      <div className="fields-2">
        <Field label="Units bought">
          <input name="units" className="input" inputMode="decimal" required />
        </Field>
        <Field label="Total paid (€)" help="Including fees.">
          <input name="totalEUR" className="input" inputMode="decimal" required />
        </Field>
      </div>
      <div className="fields-2">
        <Field label="Date">
          <input name="date" type="date" className="input" max={today()} defaultValue={today()} required />
        </Field>
        <Field label="Paid with">
          <select name="from" className="input" defaultValue="same">
            <option value="same">Cash already in that account</option>
            <AccountOptions o={o} exclude={(type) => type === "pension"} />
            <option value="none">Leave balances alone</option>
          </select>
        </Field>
      </div>
      <Field label="Note">
        <input name="note" className="input" placeholder="Optional" />
      </Field>
      <div>
        <Submit>Record purchase</Submit>
      </div>
    </ActionForm>
  );
}

function MoveForm({ o }: { o: Overview }) {
  if (o.accounts.length < 2) return <p className="muted">You need two accounts to move money between.</p>;
  return (
    <ActionForm action={moveAction} className="card card-pad">
      <div className="fields-2">
        <Field label="From">
          <select name="fromAccountId" className="input">
            <AccountOptions o={o} />
          </select>
        </Field>
        <Field label="To">
          <select name="toAccountId" className="input" defaultValue={o.accounts[1]?.id}>
            <AccountOptions o={o} />
          </select>
        </Field>
      </div>
      <div className="fields-2">
        <Field label="Amount (€)">
          <input name="amount" className="input" inputMode="decimal" required />
        </Field>
        <Field label="Date">
          <input name="date" type="date" className="input" max={today()} defaultValue={today()} required />
        </Field>
      </div>
      <Field label="Note">
        <input name="note" className="input" placeholder="Optional" />
      </Field>
      <div>
        <Submit>Record move</Submit>
      </div>
    </ActionForm>
  );
}

function ValuesForm({ o }: { o: Overview }) {
  const holdings = o.accounts.flatMap((account) => account.holdings);
  return (
    <ActionForm action={setValuesAction}>
      <p className="lead" style={{ margin: 0 }}>
        Type what your apps show today. Leave a row blank to keep it as it is. Investment prices update by themselves;
        only units are asked for.
      </p>
      <div className="card">
        <table className="values-table">
          <tbody>
            {o.accounts.length > 0 && (
              <tr className="values-head">
                <td colSpan={2}>Account cash</td>
              </tr>
            )}
            {o.accounts.map((account) => (
              <ValueRow
                key={account.id}
                name={`v:account:${account.id}`}
                label={account.name}
                sub={account.typeLabel}
                current={account.cashEUR}
                display={eur(account.cashEUR)}
              />
            ))}
            {holdings.length > 0 && (
              <tr className="values-head">
                <td colSpan={2}>Investment units</td>
              </tr>
            )}
            {holdings.map((h) => (
              <ValueRow
                key={h.id}
                name={`v:holding:${h.id}`}
                label={h.label}
                sub="units"
                current={h.units}
                display={`${unitsText(h.units)} units`}
              />
            ))}
            {o.properties.length > 0 && (
              <tr className="values-head">
                <td colSpan={2}>Property (full value, not your share)</td>
              </tr>
            )}
            {o.properties.map((p) => (
              <ValueRow key={p.id} name={`v:property:${p.id}`} label={p.name} current={p.valueEUR} display={eur(p.valueEUR)} />
            ))}
            {o.liabilities.length > 0 && (
              <tr className="values-head">
                <td colSpan={2}>Debt still owed</td>
              </tr>
            )}
            {o.liabilities.map((l) => (
              <ValueRow key={l.id} name={`v:liability:${l.id}`} label={l.name} current={l.balanceEUR} display={eur(l.balanceEUR)} />
            ))}
            {o.otherAssets.length > 0 && (
              <tr className="values-head">
                <td colSpan={2}>Other</td>
              </tr>
            )}
            {o.otherAssets.map((a) => (
              <ValueRow key={a.id} name={`v:other_asset:${a.id}`} label={a.name} current={a.valueEUR} display={eur(a.valueEUR)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="fields-2">
        <Field label="As of">
          <input name="asOf" type="date" className="input" max={today()} defaultValue={today()} required />
        </Field>
        <Field label="Note">
          <input name="note" className="input" placeholder="Optional, shows in activity" />
        </Field>
      </div>
      <div>
        <Submit>Save values</Submit>
      </div>
    </ActionForm>
  );
}

function ValueRow({
  name,
  label,
  sub,
  current,
  display,
}: {
  name: string;
  label: string;
  sub?: string;
  current: string;
  display: string;
}) {
  return (
    <tr>
      <td>
        <div>{label}</div>
        <div className="row-sub">now {display}</div>
        {sub && <span className="sr-only">{sub}</span>}
      </td>
      <td>
        <input
          name={name}
          className="input"
          inputMode="decimal"
          placeholder={String(Number(current))}
          aria-label={`${label} new value`}
        />
      </td>
    </tr>
  );
}

const ADD_KINDS = [
  { key: "account", label: "Account" },
  { key: "holding", label: "Investment" },
  { key: "property", label: "Property" },
  { key: "debt", label: "Loan or mortgage" },
  { key: "other", label: "Car or other" },
] as const;

function AddForms({ o, what }: { o: Overview; what?: string }) {
  const kind = ADD_KINDS.find((k) => k.key === what)?.key ?? "account";
  return (
    <>
      <div className="actions" style={{ marginTop: 0 }}>
        {ADD_KINDS.map((k) => (
          <Link
            key={k.key}
            href={`/change?do=add&what=${k.key}`}
            className={`btn btn-small${k.key === kind ? " btn-primary" : ""}`}
          >
            {k.label}
          </Link>
        ))}
      </div>
      {kind === "account" && (
        <ActionForm action={addAccountAction} className="card card-pad">
          <div className="fields-2">
            <Field label="Name">
              <input name="name" className="input" required placeholder="Trading 212" />
            </Field>
            <Field label="Type" help="Broker cash counts as cash too.">
              <select name="type" className="input" defaultValue="bank">
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ACCOUNT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="fields-2">
            <Field label="Cash balance (€)" help="Cash only. Add investments in it separately.">
              <input name="balance" className="input" inputMode="decimal" defaultValue="0" required />
            </Field>
            <Field label="As of">
              <input name="asOf" type="date" className="input" max={today()} defaultValue={today()} required />
            </Field>
          </div>
          <div>
            <Submit>Add account</Submit>
          </div>
        </ActionForm>
      )}
      {kind === "holding" &&
        (o.accounts.some((a) => a.type !== "manual") ? (
          <ActionForm action={addHoldingAction} className="card card-pad">
            <p className="muted small" style={{ margin: 0 }}>
              For something you already hold. Bought it just now with cash from an account? Use &ldquo;Bought an
              investment&rdquo; instead, so the cash goes down.
            </p>
            <div className="fields-2">
              <Field label="Account">
                <select name="accountId" className="input">
                  <AccountOptions o={o} exclude={(type) => type === "manual"} />
                </select>
              </Field>
              <Field label="Ticker" help="As on Yahoo Finance: VWCE.DE, CSPX.L, AAPL.">
                <input name="ticker" className="input" required autoCapitalize="characters" />
              </Field>
            </div>
            <Field label="Name">
              <input name="name" className="input" required placeholder="Vanguard FTSE All-World" />
            </Field>
            <div className="fields-2">
              <Field label="Units you hold">
                <input name="units" className="input" inputMode="decimal" required />
              </Field>
              <Field label="What they cost you in total (€)" help="Needed to work out gains when you sell.">
                <input name="costEUR" className="input" inputMode="decimal" />
              </Field>
            </div>
            <Field label="As of">
              <input name="asOf" type="date" className="input" max={today()} defaultValue={today()} required />
            </Field>
            <div>
              <Submit>Add investment</Submit>
            </div>
          </ActionForm>
        ) : (
          <p className="muted">Add the broker account first.</p>
        ))}
      {kind === "property" && (
        <ActionForm action={addPropertyAction} className="card card-pad">
          <Field label="Name">
            <input name="name" className="input" required />
          </Field>
          <div className="fields-2">
            <Field label="Full value (€)" help="The whole property, not your share.">
              <input name="value" className="input" inputMode="decimal" required />
            </Field>
            <Field label="Your share (%)">
              <input name="ownershipPct" className="input" inputMode="decimal" defaultValue="100" required />
            </Field>
          </div>
          <div className="fields-2">
            <Field label="Purchase price (€)">
              <input name="purchasePrice" className="input" inputMode="decimal" />
            </Field>
            <Field label="Valued on">
              <input name="valuedAt" type="date" className="input" max={today()} defaultValue={today()} required />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" name="isPrimaryResidence" /> This is my home
          </label>
          <details className="more">
            <summary>Mortgage, rent and costs</summary>
            <div className="form-body">
              <div className="fields-2">
                <Field label="Mortgage owed (€)">
                  <input name="mortgageBalance" className="input" inputMode="decimal" />
                </Field>
                <Field label="Mortgage rate" help="e.g. 2.6%">
                  <input name="mortgageRate" className="input" inputMode="decimal" />
                </Field>
                <Field label="Mortgage payment / month (€)">
                  <input name="mortgagePayment" className="input" inputMode="decimal" />
                </Field>
              </div>
              <div className="fields-2">
                <Field label="Rent received / month (€)">
                  <input name="rentMonthly" className="input" inputMode="decimal" />
                </Field>
                <Field label="Costs / month (€)" help="IBI, community, insurance.">
                  <input name="costsMonthly" className="input" inputMode="decimal" />
                </Field>
              </div>
            </div>
          </details>
          <div>
            <Submit>Add property</Submit>
          </div>
        </ActionForm>
      )}
      {kind === "debt" && (
        <ActionForm action={addLiabilityAction} className="card card-pad">
          <div className="fields-2">
            <Field label="Name">
              <input name="name" className="input" required placeholder="Car loan" />
            </Field>
            <Field label="Still owed (€)">
              <input name="balance" className="input" inputMode="decimal" required />
            </Field>
          </div>
          <div className="fields-2">
            <Field label="Rate" help="e.g. 2.6%">
              <input name="rate" className="input" inputMode="decimal" />
            </Field>
            <Field label="Payment / month (€)">
              <input name="payment" className="input" inputMode="decimal" />
            </Field>
          </div>
          <Field label="Secured on a property?">
            <select name="propertyId" className="input" defaultValue="">
              <option value="">No, it&apos;s a loan</option>
              {o.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  Mortgage on {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <Submit>Add debt</Submit>
          </div>
        </ActionForm>
      )}
      {kind === "other" && (
        <ActionForm action={addOtherAssetAction} className="card card-pad">
          <div className="fields-2">
            <Field label="Name">
              <input name="name" className="input" required />
            </Field>
            <Field label="Kind">
              <select name="category" className="input" defaultValue="vehicle">
                {OTHER_ASSET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category[0].toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="fields-2">
            <Field label="Value (€)">
              <input name="value" className="input" inputMode="decimal" required />
            </Field>
            <Field label="Valued on">
              <input name="valuedAt" type="date" className="input" max={today()} defaultValue={today()} required />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" name="includeInNetWorth" /> Count it in net worth (cars usually aren&apos;t)
          </label>
          <Field label="Note">
            <input name="note" className="input" placeholder="Optional" />
          </Field>
          <div>
            <Submit>Add</Submit>
          </div>
        </ActionForm>
      )}
    </>
  );
}

function CloseList({ o }: { o: Overview }) {
  const rows = [
    ...o.accounts.map((a) => ({ href: `/item/account/${a.id}`, label: a.name, sub: `Account · ${eur(a.cashEUR)} cash` })),
    ...o.properties.map((p) => ({ href: `/item/property/${p.id}`, label: p.name, sub: "Property" })),
    ...o.liabilities.map((l) => ({ href: `/item/debt/${l.id}`, label: l.name, sub: "Debt" })),
    ...o.otherAssets.map((a) => ({ href: `/item/other/${a.id}`, label: a.name, sub: "Other" })),
  ];
  return (
    <>
      <p className="lead" style={{ margin: "0 0 12px" }}>
        Open the item to close it. Nothing is deleted: it leaves the overview and stays in the record. To sell an
        investment, use &ldquo;Sold an investment&rdquo; so the gain is counted.
      </p>
      <div className="card">
        {rows.map((row) => (
          <Link key={row.href} href={`${row.href}#close`} className="row">
            <span className="row-main">
              <span className="row-title">{row.label}</span>
              <span className="row-sub" style={{ display: "block" }}>{row.sub}</span>
            </span>
            <span className="faint">›</span>
          </Link>
        ))}
      </div>
    </>
  );
}
