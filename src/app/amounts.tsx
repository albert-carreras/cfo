"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Hidden totals — the calm default. Every visit starts masked; one
// tap reveals for that visit only (no persistence, the calm default always
// wins). Server pages render the real figures and wrap them in <Amount>; this
// only controls whether they're shown, never what they are.

const AmountsContext = createContext<{
  shown: boolean;
  toggle: () => void;
} | null>(null);

export function AmountsProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <AmountsContext.Provider
      value={{ shown, toggle: () => setShown((s) => !s) }}
    >
      {children}
    </AmountsContext.Provider>
  );
}

function useAmounts() {
  const ctx = useContext(AmountsContext);
  if (!ctx) throw new Error("Amount components need an <AmountsProvider>");
  return ctx;
}

export function AmountsToggle() {
  const { shown, toggle } = useAmounts();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={shown}
      className="button-secondary"
    >
      {shown ? "Hide amounts" : "Show amounts"}
    </button>
  );
}

export function Amount({ children }: { children: ReactNode }) {
  const { shown } = useAmounts();
  if (shown) return <>{children}</>;
  return (
    <span aria-label="hidden amount" className="select-none tracking-wider">
      •••••
    </span>
  );
}
