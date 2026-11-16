"use client";

import { useEffect, useState, type CSSProperties } from "react";

// A 2000s web hit counter: how many times the app has been opened. On every
// page load the reels spin up from zero to the count, then the visit itself is
// counted and the last reel rolls on by one.

let counted = false; // once per page load, whatever React does with effects

const REEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

function Reel({ digit, index }: { digit: number; index: number }) {
  // Position on the reel, 0..10 (10 is the second 0, so 9 -> 0 still rolls up).
  const [pos, setPos] = useState(digit);
  const [prev, setPrev] = useState(digit);
  const [snap, setSnap] = useState(false);
  if (digit !== prev) {
    setPrev(digit);
    setSnap(false);
    setPos(digit < prev ? 10 : digit);
  }
  return (
    <span className="reel">
      <span
        className={snap ? "reel-strip is-snap" : "reel-strip"}
        style={{ "--pos": pos, "--spin-delay": `${index * 90}ms` } as CSSProperties}
        onTransitionEnd={() => {
          if (pos === 10) {
            setSnap(true);
            setPos(0);
          }
        }}
      >
        {REEL.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>
    </span>
  );
}

export function HitCounter({ initial }: { initial: number | null }) {
  const [visits, setVisits] = useState(initial);

  useEffect(() => {
    if (counted) return;
    counted = true;
    fetch("/api/visit", { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { visits?: number | null } | null) => {
        if (typeof body?.visits === "number") setVisits(body.visits);
      })
      .catch(() => {});
  }, []);

  const digits = visits == null ? null : String(visits).padStart(6, "0").split("").map(Number);
  return (
    <span className="hits" title={visits == null ? undefined : `Opened ${visits.toLocaleString("en-US")} times`}>
      <span className="hits-hash">#</span>
      <span className="hits-reels" aria-hidden="true">
        {digits
          ? digits.map((d, i) => <Reel key={digits.length - i} digit={d} index={i} />)
          : Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="reel">
                <span className="reel-blank">-</span>
              </span>
            ))}
      </span>
      <span className="sr-only">{visits ?? "Some"}</span>
    </span>
  );
}
