"use client";

import { useSyncExternalStore } from "react";
import { XpIcon } from "./icons";
import { setTotalsHidden, subscribeTotals, totalsHidden } from "./totals";

// The toolbar's "Hide totals" switch. It stays pressed while figures are hidden.
export function HideTotals({ initial }: { initial: boolean }) {
  const hidden = useSyncExternalStore(subscribeTotals, totalsHidden, () => initial);
  return (
    <button
      type="button"
      className="tool"
      aria-pressed={hidden}
      title={hidden ? "Show your figures again" : "Hide your figures from people looking over your shoulder"}
      onClick={() => setTotalsHidden(!hidden)}
    >
      <XpIcon name="padlock" />
      {hidden ? "Show totals" : "Hide totals"}
    </button>
  );
}
