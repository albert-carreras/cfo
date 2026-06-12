"use client";

import { useFormStatus } from "react-dom";

export function RefreshButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button-secondary shrink-0" disabled={pending}>
      {pending ? (
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          Rewriting…
        </span>
      ) : (
        "Refresh the picture"
      )}
    </button>
  );
}
