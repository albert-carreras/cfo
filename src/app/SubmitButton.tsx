"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// A submit button that reflects the enclosing server-action form's pending
// state, so slow writes (a snapshot save, the monthly check) show progress
// instead of appearing to do nothing. Must be rendered inside the <form>.
export function SubmitButton({
  children,
  pendingLabel,
  className = "button-primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
