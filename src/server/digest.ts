import { eq } from "drizzle-orm";
import { dec } from "@/calc/money";
import type { AttentionItem } from "@/calc/attention";
import { db } from "./db";
import { settings } from "./db/schema";
import { getServerEnv } from "./env";
import { sendNotification, type Notification } from "./notify";
import { loadOverview } from "./overview";
import { netWorthSeries } from "./snapshots";

// The monthly nudge that replaced the AI check: how net worth moved, and the
// few things worth a couple of minutes, with a tap through to the app. Pure
// message building is split from sending so it can be tested.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Attention items reduced to amount-free phrases for a public push topic.
function shortItem(item: AttentionItem): string {
  if (item.id === "prices") return "a price isn't updating";
  if (item.id.startsWith("negative-")) return item.title.toLowerCase();
  if (item.id.startsWith("tax-basis-")) return "a sale is missing its cost basis";
  if (item.id.startsWith("tax-")) {
    return item.level === "high" ? "last year's tax is overdue" : "tax on this year's sales to keep aside";
  }
  if (item.id === "stale-values") {
    const count = item.detail ? item.detail.split(", ").length : 1;
    return count === 1 ? "1 value to confirm" : `${count} values to confirm`;
  }
  if (item.id.startsWith("plan-")) return "a plan's date has passed";
  if (item.id === "spend-above-safe") return "spending is above the safe level";
  return "planning inputs to check";
}

// month: the month just finished (YYYY-MM); changePct: net worth across it.
export function buildDigest(args: {
  month: string;
  changePct: number | null;
  items: AttentionItem[];
  url?: string;
}): Notification {
  const name = MONTHS[Number(args.month.slice(5, 7)) - 1];
  const move =
    args.changePct === null
      ? null
      : Math.abs(args.changePct) < 0.05
        ? `Net worth was flat in ${name}.`
        : `Net worth ${args.changePct > 0 ? "rose" : "fell"} ${Math.abs(args.changePct).toFixed(1)}% in ${name}.`;
  const todo =
    args.items.length === 0
      ? "Nothing needs you."
      : `Worth a look: ${args.items.map(shortItem).join("; ")}.`;
  return {
    title: `CFO · ${name}`,
    message: [move, todo].filter(Boolean).join(" "),
    priority: args.items.some((item) => item.level === "high") ? "high" : "default",
    tags: [args.items.length === 0 ? "white_check_mark" : "memo"],
    click: args.url,
  };
}

// Runs on the 1st and looks back at the month that just ended. Idempotent per
// month: re-running the cron does not ping twice.
export async function runMonthlyDigest(now = new Date()) {
  const key = `digest:${now.toISOString().slice(0, 7)}`;
  const [sent] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (sent) return { key, sent: false, reason: "already sent" };

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = start.toISOString().slice(0, 7);
  const [overview, series] = await Promise.all([loadOverview(now), netWorthSeries()]);
  const current = Number(overview.snapshot.netWorth.value.totalEUR);
  // The last point before that month began.
  const baseline = series.filter((point) => point.asOf < `${month}-01`).at(-1);
  const changePct =
    baseline && baseline.totalEUR !== 0
      ? dec(current).minus(baseline.totalEUR).dividedBy(Math.abs(baseline.totalEUR)).times(100).toNumber()
      : null;
  const notification = buildDigest({
    month,
    changePct,
    items: overview.snapshot.attention.value.items,
    url: getServerEnv().CFO_PUBLIC_URL,
  });
  const result = await sendNotification(notification);
  // A network failure may retry on the next run; sent or disabled is final.
  if (result !== "failed") {
    await db.insert(settings).values({ key, value: result }).onConflictDoNothing();
  }
  return { key, sent: result === "sent", result, notification };
}
