import { getServerEnv } from "./env";

// Push notifications via ntfy (NTFY_URL, e.g. https://ntfy.sh/<topic>).
// Public topics are guessable, so payloads never carry € amounts: percentages,
// counts and names only. Fire-and-forget: NTFY_URL absent ⇒ no-op, and a
// failure is swallowed so a dead notifier never breaks what it reports on.

export type Notification = {
  title: string;
  message: string;
  priority: "default" | "high";
  tags: string[];
  // Opens this URL when the notification is tapped.
  click?: string;
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
        ...(notification.click ? { Click: notification.click } : {}),
      },
      body: notification.message,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export function failureNotification(error: string): Notification {
  return {
    title: "CFO: daily price update failed",
    message: error,
    priority: "high",
    tags: ["rotating_light"],
  };
}
