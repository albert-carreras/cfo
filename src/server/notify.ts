import { getServerEnv } from "./env";
import type { StatusLevel, StatusValue } from "@/calc/status";
import type { MaterialChangeValue } from "@/calc/materialChange";

// Push notifications via ntfy (NTFY_URL env, e.g. https://ntfy.sh/<topic>).
// Two halves, deliberately split:
//   - decide*Notifications: PURE rules (tested) mapping pipeline outcomes to
//     zero or more messages. The payload discipline lives here: the topic is
//     guessable on ntfy.sh, so messages carry status labels, percents and
//     months — never € amounts (the material-change `detail` strings DO carry
//     amounts, which is why the rules rebuild coarse text from `kind`).
//   - sendNotification: the one impure edge. Fire-and-forget POST; NTFY_URL
//     absent ⇒ no-op, a timeout or network error is swallowed — a dead
//     notifier must never fail the pipeline it reports on.

export type Notification = {
  title: string;
  message: string;
  priority: "default" | "high";
  tags: string[];
};

export type SendResult = "sent" | "disabled" | "failed";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean }>;

export async function sendNotification(
  notification: Notification,
  opts: { url?: string; fetchImpl?: FetchLike } = {},
): Promise<SendResult> {
  // An explicit `url` (even undefined) wins over env, so tests never need a
  // server environment to exercise the disabled path.
  const url = "url" in opts ? opts.url : getServerEnv().NTFY_URL;
  if (!url) return "disabled";
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Title: notification.title,
        Priority: notification.priority,
        Tags: notification.tags.join(","),
      },
      body: notification.message,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

// Statuses worth waking a phone for; a recovery back to stable pings calmly.
const ALERT_LEVELS: ReadonlySet<StatusLevel> = new Set([
  "urgent",
  "action_recommended",
  "data_stale",
]);

export function decideDailyNotifications(args: {
  previousStatus: StatusLevel | null;
  status: StatusValue;
  // `strategic.reason` from the daily update — only "material change" pings;
  // month-rolls and first snapshots are routine.
  strategicReason: string | null;
  materialChange: Pick<MaterialChangeValue, "changes" | "netWorthDeltaPct">;
  priceFailures: { symbol: string | null; isin: string }[];
  fxErrors: string[];
  assumptionFeedErrors: string[];
}): Notification[] {
  const out: Notification[] = [];

  // 1. The status light changed — the one ping that mirrors the home screen.
  if (args.previousStatus !== null && args.previousStatus !== args.status.status) {
    const alarming = ALERT_LEVELS.has(args.status.status);
    out.push({
      title: `CFO status: ${args.status.label}`,
      message: args.status.reason,
      priority: alarming ? "high" : "default",
      tags: [alarming ? "warning" : "white_check_mark"],
    });
  }

  // 2. The material-change firewall tripped mid-month. Coarse by construction:
  // kinds + the signed % move, never the amount-bearing detail strings.
  if (args.strategicReason === "material change") {
    const kinds = args.materialChange.changes.map((c) => c.kind).join(", ");
    const pct = args.materialChange.netWorthDeltaPct;
    out.push({
      title: "CFO: material change",
      message:
        `Strategic snapshot promoted off-cycle (${kinds}).` +
        (pct !== null ? ` Net worth moved ${pct}%.` : ""),
      priority: "default",
      tags: ["chart_with_upwards_trend"],
    });
  }

  // 3. The watch itself is broken — symbols and feed names only.
  const failures: string[] = [];
  if (args.priceFailures.length > 0) {
    failures.push(
      `${args.priceFailures.length} price fetch(es) failed: ${args.priceFailures
        .map((f) => f.symbol ?? f.isin)
        .join(", ")}`,
    );
  }
  if (args.fxErrors.length > 0) failures.push(`FX: ${args.fxErrors.join("; ")}`);
  if (args.assumptionFeedErrors.length > 0) {
    failures.push(`assumption feed: ${args.assumptionFeedErrors.join("; ")}`);
  }
  if (failures.length > 0) {
    out.push({
      title: "CFO: feed problems",
      message: failures.join(" · "),
      priority: args.priceFailures.length > 0 ? "high" : "default",
      tags: ["construction"],
    });
  }

  return out;
}

export function reviewNotification(args: {
  month: string;
  scope: "full" | "deterministic";
  llmError: string | null;
  hasRecommendation: boolean;
  requiresManualReview: boolean;
}): Notification {
  const rec = args.hasRecommendation
    ? args.requiresManualReview
      ? "1 recommendation (needs manual review)"
      : "1 recommendation"
    : "no recommendation";
  const scope =
    args.scope === "full"
      ? "full scope"
      : `deterministic floor (${args.llmError ?? "no provider"})`;
  return {
    title: `CFO: ${args.month} review published`,
    message: `${scope} — ${rec}. Read it on /reviews.`,
    priority: "default",
    tags: ["memo"],
  };
}

export function failureNotification(error: string): Notification {
  return {
    title: "CFO: daily update FAILED",
    message: error,
    priority: "high",
    tags: ["rotating_light"],
  };
}
