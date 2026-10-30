// Date helpers for ISO YYYY-MM-DD strings. Pure: the caller passes "today".

export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

// "today", "12 days", "3 months", "1 year": coarse, for "last confirmed".
export function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days < 45) return days === 1 ? "1 day" : `${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30.4);
    return months === 1 ? "1 month" : `${months} months`;
  }
  const years = Math.floor(days / 365);
  const months = Math.round((days - years * 365) / 30.4);
  const head = years === 1 ? "1 year" : `${years} years`;
  return months >= 1 && months < 12 ? `${head} ${months} mo` : head;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
