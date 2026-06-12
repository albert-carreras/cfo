import { describe, expect, it } from "vitest";
import {
  decideDailyNotifications,
  failureNotification,
  reviewNotification,
  sendNotification,
  type FetchLike,
} from "@/server/notify";
import type { StatusValue } from "@/calc/status";

// The notification rules are pure and the send edge is harmless by
// construction: no NTFY_URL ⇒ no-op, any network trouble ⇒ "failed", never a
// throw. The payload discipline (a public ntfy topic is guessable): labels,
// percents and months only — never € amounts.

const stable: StatusValue = {
  status: "stable",
  label: "Stable",
  reason: "Nothing material changed since the last snapshot.",
};
const action: StatusValue = {
  status: "action_recommended",
  label: "Action recommended",
  reason: "Spend assumption is 12% above the safe monthly spend.",
};

const quiet = {
  previousStatus: "stable" as const,
  status: stable,
  strategicReason: null,
  materialChange: { changes: [], netWorthDeltaPct: null },
  priceFailures: [],
  fxErrors: [],
  assumptionFeedErrors: [],
};

describe("decideDailyNotifications", () => {
  it("a quiet day sends nothing — silence stays meaningful", () => {
    expect(decideDailyNotifications(quiet)).toEqual([]);
  });

  it("the very first run (no previous status) does not ping", () => {
    expect(
      decideDailyNotifications({ ...quiet, previousStatus: null }),
    ).toEqual([]);
  });

  it("a status TRANSITION pings; worsening is high priority, recovery calm", () => {
    const worsened = decideDailyNotifications({ ...quiet, status: action });
    expect(worsened).toHaveLength(1);
    expect(worsened[0]).toMatchObject({
      title: "CFO status: Action recommended",
      message: action.reason,
      priority: "high",
    });

    const recovered = decideDailyNotifications({
      ...quiet,
      previousStatus: "action_recommended",
      status: stable,
    });
    expect(recovered[0]).toMatchObject({
      title: "CFO status: Stable",
      priority: "default",
    });
  });

  it("an unchanged non-stable status does NOT re-ping every day", () => {
    expect(
      decideDailyNotifications({
        ...quiet,
        previousStatus: "action_recommended",
        status: action,
      }),
    ).toEqual([]);
  });

  it("a material-change promotion pings coarsely — kinds and %, never the €-bearing details", () => {
    const out = decideDailyNotifications({
      ...quiet,
      strategicReason: "material change",
      materialChange: {
        changes: [
          {
            kind: "net_worth_move",
            detail: "Net worth moved -6.2% (€812000 → €761656) since 2026-06-01.",
          },
        ],
        netWorthDeltaPct: "-6.2",
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("net_worth_move");
    expect(out[0].message).toContain("-6.2%");
    expect(out[0].message).not.toContain("€");
    expect(out[0].message).not.toContain("812000");
  });

  it("a routine month-roll promotion does not ping", () => {
    expect(
      decideDailyNotifications({ ...quiet, strategicReason: "month rolled over" }),
    ).toEqual([]);
  });

  it("feed failures ping with symbols only, high priority when prices broke", () => {
    const out = decideDailyNotifications({
      ...quiet,
      priceFailures: [{ symbol: "VWCE.DE", isin: "IE00BK5BQT80" }],
      fxErrors: ["no ECB rate for USD"],
      assumptionFeedErrors: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "CFO: feed problems", priority: "high" });
    expect(out[0].message).toContain("VWCE.DE");
    expect(out[0].message).toContain("no ECB rate for USD");
  });
});

describe("reviewNotification / failureNotification", () => {
  it("describes scope and the recommendation gate outcome", () => {
    expect(
      reviewNotification({
        month: "2026-06",
        scope: "full",
        llmError: null,
        hasRecommendation: true,
        requiresManualReview: true,
      }).message,
    ).toBe("full scope — 1 recommendation (needs manual review). Read it on /reviews.");

    expect(
      reviewNotification({
        month: "2026-06",
        scope: "deterministic",
        llmError: "no-key",
        hasRecommendation: false,
        requiresManualReview: false,
      }).message,
    ).toBe("deterministic floor (no-key) — no recommendation. Read it on /reviews.");
  });

  it("a whole-run failure is a high-priority ping", () => {
    expect(failureNotification("db unreachable")).toMatchObject({
      priority: "high",
      message: "db unreachable",
    });
  });
});

describe("sendNotification", () => {
  it("is a no-op without a URL and swallows network failures", async () => {
    expect(
      await sendNotification(failureNotification("x"), { url: undefined }),
    ).toBe("disabled");

    const boom: FetchLike = async () => {
      throw new Error("network down");
    };
    expect(
      await sendNotification(failureNotification("x"), {
        url: "https://ntfy.sh/t",
        fetchImpl: boom,
      }),
    ).toBe("failed");
  });

  it("POSTs message as body with Title/Priority/Tags headers", async () => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    };
    const result = await sendNotification(
      {
        title: "CFO status: Stable",
        message: "Nothing material changed.",
        priority: "default",
        tags: ["white_check_mark"],
      },
      { url: "https://ntfy.sh/topic", fetchImpl: fake },
    );
    expect(result).toBe("sent");
    expect(calls[0].url).toBe("https://ntfy.sh/topic");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("Nothing material changed.");
    expect(calls[0].init.headers).toMatchObject({
      Title: "CFO status: Stable",
      Priority: "default",
      Tags: "white_check_mark",
    });
  });
});
