// "Hide totals": every personal figure shows as dots. Remembered per device in
// a cookie, so the server paints the first frame already hidden.

export const HIDE_TOTALS_COOKIE = "cfo-hide-totals";
const CLASS = "hide-totals";
const listeners = new Set<() => void>();

export function subscribeTotals(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function totalsHidden() {
  return document.documentElement.classList.contains(CLASS);
}

export function setTotalsHidden(hidden: boolean) {
  document.documentElement.classList.toggle(CLASS, hidden);
  document.cookie = hidden
    ? `${HIDE_TOTALS_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
    : `${HIDE_TOTALS_COOKIE}=; path=/; max-age=0; samesite=lax`;
  for (const listener of listeners) listener();
}
