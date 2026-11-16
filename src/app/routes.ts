import type { XpIconName } from "./icons";

// Which page is which, for window titles, the address bar and deciding which
// window a page opens in. Plain functions: used by server and client code.

// Pages that open in a window of their own when you get to them from inside the
// app. Loaded directly, they fill the main window instead.
export const SIDE_ROUTE = /^\/(tax|plans|inputs|item)(\/|$)/;

export function isSideRoute(path: string) {
  return SIDE_ROUTE.test(path);
}

const CHANGE_STEPS: Record<string, string> = {
  sell: "Sold an investment",
  buy: "Bought an investment",
  move: "Moved money",
  values: "Update balances",
  add: "Opened or got something",
  close: "Closed or sold something else",
};

const ITEM_KINDS: Record<string, { label: string; icon: XpIconName }> = {
  account: { label: "Account", icon: "folder" },
  holding: { label: "Investment", icon: "graph" },
  property: { label: "Property", icon: "home" },
  debt: { label: "Debt", icon: "certificate" },
  other: { label: "Other asset", icon: "briefcase" },
};

// "/change?do=sell" -> ["Something happened", "Sold an investment"].
export function describe(url: string): string[] {
  const parsed = new URL(url, "http://cfo.local");
  const [first, kind] = parsed.pathname.split("/").filter(Boolean);
  switch (first) {
    case undefined:
      return ["Overview"];
    case "change": {
      const step = CHANGE_STEPS[parsed.searchParams.get("do") ?? ""];
      return step ? ["Something happened", step] : ["Something happened"];
    }
    case "activity":
      return ["Activity"];
    case "tax":
      return ["Tax"];
    case "plans":
      return ["Plans"];
    case "inputs":
      return ["Inputs"];
    case "item":
      return ["Overview", ITEM_KINDS[kind]?.label ?? "Item"];
    default:
      return ["Not found"];
  }
}

export function itemKind(kind: string) {
  return ITEM_KINDS[kind] ?? { label: "Item", icon: "briefcase" as XpIconName };
}

// The page one level up, for the Up button.
export function parentOf(url: string): string | null {
  const parsed = new URL(url, "http://cfo.local");
  if (parsed.pathname === "/") return null;
  if (parsed.pathname === "/change" && parsed.searchParams.get("do")) return "/change";
  return "/";
}
