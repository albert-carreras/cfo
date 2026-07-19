import { createId } from "@paralleldrive/cuid2";
import { desc, eq } from "drizzle-orm";
import {
  runHealthCheckModel,
  type HealthCheckReport,
  type HealthCheckSummary,
  type HealthVerdict,
} from "@/ai/check";
import { computeSnapshot, type StrategicSnapshot } from "@/calc/snapshot";
import { db } from "./db";
import { healthChecks, plannedEvents } from "./db/schema";
import { getServerEnv } from "./env";
import { loadFacts } from "./facts";
import { sendNotification } from "./notify";
import {
  isReviewDue,
  latestStrategicSnapshot,
  persistSnapshot,
} from "./snapshots";

export type HealthCheckRow = typeof healthChecks.$inferSelect;

const RANK: Record<HealthVerdict, number> = { ok: 0, watch: 1, update: 2 };

function stronger(a: HealthVerdict, b: HealthVerdict): HealthVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}

export function deterministicVerdict(snapshot: StrategicSnapshot): HealthVerdict {
  if (
    snapshot.status.value.status === "data_stale" ||
    snapshot.dataQuality.value.missingRequired.length > 0
  ) {
    return "update";
  }
  if (
    snapshot.status.value.status === "urgent" ||
    snapshot.status.value.status === "action_recommended" ||
    snapshot.fire.value.bands?.base.holds === false
  ) {
    return "watch";
  }
  return "ok";
}

function summaryFor(
  snapshot: StrategicSnapshot,
  plans: {
    type: string;
    date: string;
    amount: string;
    note: string | null;
    realisedAt: Date | null;
  }[],
): HealthCheckSummary {
  const position = snapshot.netWorth.value;
  const fire = snapshot.fire.value;
  const openPlans = plans.filter((plan) => !plan.realisedAt);
  const concentrations: string[] = [];
  if (snapshot.concentration.value.brokers.some((line) => line.above)) {
    concentrations.push("Broker concentration is above the configured ceiling.");
  }
  if (snapshot.concentration.value.positions.some((line) => line.above)) {
    concentrations.push("A position is above the configured concentration ceiling.");
  }
  if (snapshot.concentration.value.realEstate?.above) {
    concentrations.push("Real-estate exposure is above the configured ceiling.");
  }
  return {
    asOf: snapshot.asOf,
    deterministicVerdict: deterministicVerdict(snapshot),
    metrics: {
      netWorthEUR: position.totalEUR,
      liquidEUR: position.liquidEUR,
      investableEUR: position.investableEUR,
      lockedEUR: position.lockedEUR,
      propertyEquityEUR: position.illiquidEUR,
      debtEUR: position.debtEUR,
      monthlySpendEUR: fire.monthlySpendEUR,
      safeMonthlySpendEUR: fire.safeMonthlySpendEUR,
      runwayYears: fire.runwayYears,
      basePlanHolds: fire.bands?.base.holds ?? null,
      conservativePlanHolds: fire.bands?.conservative.holds ?? null,
    },
    data: {
      score: snapshot.dataQuality.value.score,
      missing: snapshot.dataQuality.value.missing,
      flags: snapshot.dataQuality.value.flags,
    },
    plans: openPlans.map((plan) => ({
      type: plan.type,
      date: plan.date,
      amountEUR: plan.amount,
      note: plan.note,
    })),
    concentrations,
  };
}

async function currentStrategicSnapshot(now: Date) {
  const asOf = now.toISOString().slice(0, 10);
  const previous = await latestStrategicSnapshot();
  const bundle = await loadFacts();
  const snapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: isReviewDue(previous?.computedAt ?? null, asOf),
    facts: bundle.facts,
  });
  await persistSnapshot("strategic", snapshot, {
    computedAt: now,
    dedupeKey: `strategic:${asOf}`,
  });
  return snapshot;
}

export async function runHealthCheck(options: {
  trigger: "scheduled" | "manual";
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const month = now.toISOString().slice(0, 7);
  const dedupeKey =
    options.trigger === "scheduled" ? `scheduled:${month}` : null;
  if (dedupeKey) {
    const [existing] = await db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) return existing;
  }

  const [snapshot, plans] = await Promise.all([
    currentStrategicSnapshot(now),
    db.select().from(plannedEvents),
  ]);
  const summary = summaryFor(snapshot, plans);
  const env = getServerEnv();
  let report: HealthCheckReport | null = null;
  let model: string | null = null;
  let llmError: string | null = null;
  if (env.OPENAI_API_KEY) {
    try {
      const result = await runHealthCheckModel({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        summary,
      });
      report = result.report;
      model = result.model;
    } catch (error) {
      llmError = error instanceof Error ? error.message : String(error);
    }
  } else {
    llmError = "provider disabled";
  }

  const verdict = report
    ? stronger(summary.deterministicVerdict, report.verdict)
    : summary.deterministicVerdict;
  const [row] = await db
    .insert(healthChecks)
    .values({
      trigger: options.trigger,
      dedupeKey,
      snapshotId: snapshot.snapshotId,
      verdict,
      summary,
      report,
      model,
      llmError,
    })
    .returning();

  await sendNotification({
    title: verdict === "ok" ? "CFO check: okay" : "CFO check: worth a look",
    message:
      report?.headline ??
      (verdict === "update"
        ? "The check completed, but some source data needs updating."
        : verdict === "watch"
          ? "The check completed with something worth reviewing."
          : "The check completed with no material concern."),
    priority: "default",
    tags: [verdict === "ok" ? "white_check_mark" : "memo"],
  });
  return row;
}

export async function latestHealthCheck() {
  const [row] = await db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.createdAt), desc(healthChecks.id))
    .limit(1);
  return row ?? null;
}

export async function listHealthChecks(limit = 24) {
  return db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.createdAt), desc(healthChecks.id))
    .limit(limit);
}
