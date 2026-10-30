import { dec, formatUnits } from "@/calc/money";
import { loadOverview } from "./overview";

// The Markdown handoff for a ChatGPT/Claude project: the current record with
// its dates, calculated figures, known gaps and instructions that keep facts,
// calculations and judgment apart in the receiving conversation.

function eur(value: string | number | null | undefined): string {
  if (value == null) return "unknown";
  return `€${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(value: string | null | undefined): string {
  if (value == null) return "unknown";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export async function buildContextPack(now = new Date()) {
  const o = await loadOverview(now);
  const nw = o.snapshot.netWorth.value;
  const fire = o.snapshot.fire.value;
  const input = (key: string) => o.inputs[key];

  const lines: string[] = [
    "# Personal financial context",
    "",
    `Generated: ${o.asOf}`,
    "",
    "> Verified personal facts and deterministic calculations from my own record. Dates matter: a value is as of the date shown. Ask before assuming anything decision-critical that is missing.",
    "",
    "## Position (calculated)",
    "",
    `- Net worth: ${eur(nw.totalEUR)}`,
    `- Cash (all non-pension accounts): ${eur(nw.cashEUR)}`,
    `- Investments (market value): ${eur(nw.investmentsEUR)}`,
    `- Pension (locked): ${eur(nw.pensionEUR)}`,
    `- Property equity (my share, after mortgages): ${eur(nw.propertyEquityEUR)}`,
    `- Other assets counted: ${eur(nw.otherAssetsEUR)}`,
    `- Debt: ${eur(nw.debtEUR)}`,
    `- Estimated tax due on realised gains, not yet paid (already deducted above): ${eur(nw.taxDueEUR)}`,
    `- Available (cash + investments − general debt − tax due): ${eur(nw.availableEUR)}`,
    "",
    "## Spending",
    "",
    `- Monthly spend: ${fire.monthlySpendEUR ? eur(fire.monthlySpendEUR) : "not set"}`,
    `- Safe withdrawal rate: ${pct(fire.safeWithdrawalRate)}`,
    `- Safe monthly spend from the available pile: ${eur(fire.safeMonthlySpendEUR)}`,
    `- Spend fits the safe level: ${fire.fits === null ? "unknown" : fire.fits ? "yes" : "no"}`,
    `- Years the available pile lasts at zero growth: ${fire.runwayYears ?? "unknown"}`,
    "",
    "## Accounts and investments (verified balances and units; calculated market values)",
    "",
  ];

  for (const account of o.accounts) {
    lines.push(
      `- ${account.name} [${account.typeLabel}]: cash ${eur(account.cashEUR)}, confirmed ${account.confirmedAt}`,
    );
    for (const h of account.holdings) {
      const parts = [
        `${formatUnits(h.units)} units`,
        h.priced ? `price ${eur(h.priceEUR)} on ${h.priceAsOf}` : "no current price",
        `value ${eur(h.valueEUR)}`,
        h.costBasisEUR ? `FIFO cost basis ${eur(h.costBasisEUR)}` : "cost basis unknown",
      ];
      if (h.gainEUR) parts.push(`unrealised ${dec(h.gainEUR).isNegative() ? "loss" : "gain"} ${eur(dec(h.gainEUR).abs().toFixed(2))}`);
      parts.push(`units confirmed ${h.confirmedAt}`);
      lines.push(`  - ${h.label}${h.ticker && h.name !== h.ticker ? ` (${h.name})` : ""}: ${parts.join("; ")}`);
    }
  }
  if (o.accounts.length === 0) lines.push("- None recorded.");

  lines.push("", "## Realised sales and tax (Spain, savings scale)", "");
  if (o.taxYears.length === 0) lines.push("- No sales recorded.");
  for (const year of o.taxYears) {
    lines.push(
      `- ${year.year}: net gain ${eur(year.gainEUR)} over ${year.saleCount} sale(s); estimated tax ${eur(year.taxEUR)}; ${year.settled ? `paid ${year.settled.paidAt} (${eur(year.settled.amountEUR)})` : `not paid yet, due by ${year.dueBy}`}${year.unknownBasisCount ? `; ${year.unknownBasisCount} sale(s) with unknown cost basis left out` : ""}`,
    );
    for (const sale of year.sales) {
      lines.push(
        `  - ${sale.soldAt}: sold ${formatUnits(sale.quantity)} ${sale.holding} for ${eur(sale.proceedsEUR)}; cost basis ${sale.costBasisEUR ? `${eur(sale.costBasisEUR)} (${sale.costBasisSource})` : "unknown"}`,
      );
    }
  }
  if (o.taxYears.length > 0) {
    lines.push(
      "- The estimate covers security sales only: not interest, dividends or loss carry-forwards from earlier years.",
    );
  }

  lines.push("", "## Property", "");
  if (o.properties.length === 0) lines.push("- None recorded.");
  for (const p of o.properties) {
    lines.push(
      `- ${p.name}: value ${eur(p.valueEUR)} (valued ${p.valuedAt}); ${p.ownershipPct}% mine = ${eur(p.shareEUR)}; mortgage ${eur(p.mortgageEUR)}; equity ${eur(p.equityEUR)}; purchase price ${p.purchasePrice ? eur(p.purchasePrice) : "unknown"}; rent ${eur(p.rentMonthly)}/month; costs ${eur(p.costsMonthly)}/month${p.isPrimaryResidence ? "; my home" : ""}`,
    );
  }

  lines.push("", "## Debt", "");
  if (o.liabilities.length === 0) lines.push("- None recorded.");
  for (const l of o.liabilities) {
    lines.push(
      `- ${l.name}: balance ${eur(l.balanceEUR)} (as of ${l.valuedAt}); rate ${pct(l.rate)}; payment ${eur(l.payment)}/month${l.propertyName ? `; secured on ${l.propertyName}` : ""}`,
    );
  }

  lines.push("", "## Other assets", "");
  if (o.otherAssets.length === 0) lines.push("- None recorded.");
  for (const a of o.otherAssets) {
    lines.push(
      `- ${a.name} [${a.category}]: ${eur(a.valueEUR)} (valued ${a.valuedAt}); ${a.includeInNetWorth ? "counted" : "not counted"} in net worth${a.note ? `; ${a.note}` : ""}`,
    );
  }

  lines.push("", "## Planning inputs", "");
  const describe = (key: string, label: string, format: (v: string) => string = (v) => v) => {
    const row = input(key);
    lines.push(
      `- ${label}: ${row?.value ? format(row.value) : "not recorded"}${row ? ` (reviewed ${row.lastReviewedAt})` : ""}`,
    );
  };
  describe("monthlyNetIncome", "Monthly net income", eur);
  describe("monthlyHousingCost", "Monthly housing cost", eur);
  describe("birthDate", "Date of birth");

  lines.push("", "## Planned major changes (intentions, not facts)", "");
  if (o.plans.length === 0) lines.push("- None recorded.");
  for (const plan of o.plans) {
    lines.push(
      `- ${plan.label}: ${plan.amountTBD ? "amount TBD" : eur(plan.amount)}, ${plan.timingUnknown ? "timing unknown" : `around ${plan.date}`}${plan.note ? `; ${plan.note}` : ""}`,
    );
  }

  const gaps = [
    ...o.snapshot.attention.value.items.map((item) =>
      item.detail ? `${item.title}: ${item.detail}` : item.title,
    ),
    ...(input("monthlyNetIncome")?.value ? [] : ["Net income is not recorded; affordability questions need it."]),
    ...o.properties
      .filter((p) => !p.purchasePrice)
      .map((p) => `${p.name} has no purchase price recorded.`),
  ];
  lines.push("", "## Gaps and things to refresh", "");
  if (gaps.length === 0) lines.push("- Nothing known. Reconfirm decision-specific facts before a big commitment.");
  for (const gap of gaps) lines.push(`- ${gap}`);

  lines.push(
    "",
    "## Instructions for an AI using this file",
    "",
    "- Keep verified facts, these calculations and your own judgment apart, and say which is which.",
    "- Do not silently assume missing income, financing terms, taxes, transaction costs or sale proceeds.",
    "- For a major decision, say which facts need refreshing before recommending anything.",
    "- Treat planned changes as intentions, not assets or debts that already exist.",
    "- Be direct about trade-offs and uncertainty; skip generic disclaimers.",
    "",
  );
  return lines.join("\n");
}
