"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "./actions";

// A form that calls a server action without React's automatic reset, so a
// rejected entry keeps what was typed and shows why. Success redirects from
// the action itself.

const PendingContext = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (state: ActionResult, form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  // Asked before submitting, for things that are awkward to undo.
  confirm?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await action(undefined, form);
          if (result?.error) setError(result.error);
        });
      }}
    >
      {error && (
        <p className="alert alert-bad" role="alert">
          {error}
        </p>
      )}
      <PendingContext.Provider value={pending}>
        <fieldset className="form-body" disabled={pending}>
          {children}
        </fieldset>
      </PendingContext.Provider>
    </form>
  );
}

export function Submit({
  children,
  className = "btn btn-primary",
}: {
  children: ReactNode;
  className?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" className={className} aria-busy={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
