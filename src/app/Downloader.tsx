"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { XpIcon, type XpIconName } from "./icons";
import { TitleBar } from "./TitleBar";
import { useWindowDrag } from "./useWindowDrag";
import { useWm, wm, zIndexOf } from "./wm";

// Decoration, not data: a peer-to-peer style transfers window that is always
// "downloading" something at dial-up speeds. Nothing is fetched and none of
// these figures is about your money.

type State = "down" | "stalled" | "queued" | "done";
type Transfer = {
  key: number;
  name: string;
  icon: XpIconName;
  size: number;
  got: number;
  speed: number;
  sources: number;
  of: number;
  state: State;
  hold: number;
  rank: number;
};

const POOL: [string, XpIconName, number][] = [
  ["eurofxref-daily.xml", "xml", 412_000],
  ["VWCE.DE_quotes_1999-2026.csv", "txt", 2_840_000],
  ["net_worth_(club_mix).mp3", "media", 4_620_000],
  ["pension_plan_FINAL_final(2).zip", "zip", 1_310_000],
  ["Spending_Habits_(uncut).avi", "media", 699_000_000],
  ["tax_estimate_2026.txt", "txt", 96_000],
  ["boring_index_fund_anthem.mp3", "media", 3_900_000],
  ["ledger_backup_DO_NOT_DELETE.zip", "zip", 8_700_000],
];

const MAX_ACTIVE = 2;

function make(key: number, at: number, state: State, got = 0): Transfer {
  const [name, icon, size] = POOL[at % POOL.length];
  return { key, name, icon, size, got, speed: state === "down" ? 2.4 : 0, sources: 2, of: 11, state, hold: 0, rank: 1345 };
}

const START: Transfer[] = [make(0, 0, "down", 151_000), make(1, 1, "down", 640_000), make(2, 4, "queued")];

function jitter(value: number, by: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value + (Math.random() - 0.5) * by));
}

function tick(list: Transfer[], next: { key: number; at: number }): Transfer[] {
  let out = list.map((t): Transfer => {
    switch (t.state) {
      case "down": {
        if (Math.random() < 0.05) return { ...t, state: "stalled", speed: 0, hold: 3 + Math.floor(Math.random() * 6) };
        const speed = jitter(t.speed, 1.8, 0.3, 11.5);
        const got = Math.min(t.size, t.got + speed * 1024);
        const sources = Math.round(jitter(t.sources, 1.2, 1, 6));
        const of = Math.round(jitter(t.of, 2, sources + 3, 40));
        if (got >= t.size) return { ...t, got, speed: 0, state: "done", hold: 5 };
        return { ...t, got, speed, sources, of };
      }
      case "stalled":
        return t.hold <= 1 ? { ...t, state: "down", speed: 0.8, hold: 0 } : { ...t, hold: t.hold - 1 };
      case "queued":
        return { ...t, rank: Math.max(1, t.rank - Math.floor(Math.random() * 4)) };
      case "done":
        return { ...t, hold: t.hold - 1 };
    }
  });
  // Finished files leave the list; the next one joins the queue.
  out = out.flatMap((t) => {
    if (t.state !== "done" || t.hold > 0) return [t];
    const fresh = make(next.key++, next.at++, "queued");
    return [{ ...fresh, rank: 200 + Math.floor(Math.random() * 1800) }];
  });
  // Free slots start the first queued file (the huge one never gets a slot).
  let active = out.filter((t) => t.state === "down" || t.state === "stalled").length;
  out = out.map((t) => {
    if (active < MAX_ACTIVE && t.state === "queued" && t.size < 100_000_000) {
      active++;
      return { ...t, state: "down", speed: 1.2 };
    }
    return t;
  });
  return out;
}

// --- The tray readout ---------------------------------------------------------

let traySpeed = 0;
let trayBlink = false;
const trayListeners = new Set<() => void>();
function publish(speed: number) {
  traySpeed = speed;
  trayBlink = !trayBlink && speed > 0;
  for (const listener of trayListeners) listener();
}
const subscribeTray = (listener: () => void) => {
  trayListeners.add(listener);
  return () => {
    trayListeners.delete(listener);
  };
};

export function useTraySpeed() {
  const speed = useSyncExternalStore(subscribeTray, () => traySpeed, () => 0);
  const blink = useSyncExternalStore(subscribeTray, () => trayBlink, () => false);
  return { speed, blink };
}

export function formatRate(kb: number) {
  return `${kb.toFixed(1)} KB/s`;
}

function formatSize(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds)) return "∞";
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

const CLOSED_KEY = "cfo.transfers.closed";

// From the tray: forget that it was closed and bring it back.
export function forgetTransfersClosed() {
  try {
    window.localStorage.removeItem(CLOSED_KEY);
  } catch {}
}

export function Downloader() {
  const [list, setList] = useState(START);
  const [up, setUp] = useState(0.6);
  const s = useWm();
  const w = s.wins.transfers;
  const drag = useWindowDrag(true);
  const moved = drag.offset.x !== 0 || drag.offset.y !== 0;

  useEffect(() => {
    const next = { key: START.length, at: 5 };
    const id = setInterval(() => {
      setList((current) => tick(current, next));
      setUp((value) => jitter(value, 0.5, 0, 2.2));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const down = list.reduce((sum, t) => sum + (t.state === "down" ? t.speed : 0), 0);
  useEffect(() => publish(down), [down]);

  // Open on wide screens unless it was closed before.
  useEffect(() => {
    let closed = false;
    try {
      closed = window.localStorage.getItem(CLOSED_KEY) === "1";
    } catch {}
    if (!closed && window.matchMedia("(min-width: 1100px)").matches) wm.show("transfers");
  }, []);

  if (!w.open) return null;

  const downloading = list.filter((t) => t.state === "down" || t.state === "stalled").length;
  const queued = list.filter((t) => t.state === "queued").length;

  const close = () => {
    wm.close("transfers");
    try {
      window.localStorage.setItem(CLOSED_KEY, "1");
    } catch {}
  };

  const classes = ["window", "transfers-window"];
  if (s.focused === "transfers") classes.push("is-active");

  return (
    <div
      data-win="transfers"
      className={classes.join(" ")}
      hidden={w.minimized}
      style={{
        zIndex: zIndexOf(s, "transfers"),
        transform: moved ? `translate(${drag.offset.x}px, ${drag.offset.y}px)` : undefined,
      }}
      onPointerDownCapture={() => wm.focus("transfers")}
      aria-label="Transfers (decorative)"
    >
      <TitleBar
        id="transfers"
        title="Transfers"
        icon="network-places"
        maximizable={false}
        onClose={close}
        onPointerDown={drag.onPointerDown}
      />
      <div className="xfer-body" aria-hidden="true">
        <div className="xfer-head">
          <span>File</span>
          <span>Progress</span>
          <span>Speed</span>
        </div>
        <ul className="xfer-list">
          {list.map((t) => {
            const pct = Math.floor((t.got / t.size) * 100);
            const status =
              t.state === "down"
                ? `${t.sources}/${t.of} sources · ${formatEta((t.size - t.got) / (t.speed * 1024))} left`
                : t.state === "stalled"
                  ? "Stalled. Waiting for sources"
                  : t.state === "queued"
                    ? `Queued (rank ${t.rank.toLocaleString("en-US")})`
                    : "Complete";
            return (
              <li key={t.key} className={`xfer xfer-${t.state}`}>
                <XpIcon name={t.icon} className="xfer-icon" />
                <span className="xfer-name">{t.name}</span>
                <span className="xfer-speed">{t.state === "down" ? formatRate(t.speed) : ""}</span>
                <span className="xp-progress">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="xfer-pct">{pct}%</span>
                <span className="xfer-status">
                  {formatSize(t.got)} of {formatSize(t.size)} · {status}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="statusbar">
          <span>
            {downloading} downloading, {queued} queued
          </span>
          <span>Down: {formatRate(down)}</span>
          <span>Up: {formatRate(up)}</span>
        </div>
      </div>
    </div>
  );
}
