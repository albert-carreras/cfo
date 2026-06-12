"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button-primary shrink-0" disabled={pending}>
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          Asking…
        </span>
      ) : (
        <>Ask <span className="ml-2" aria-hidden="true">→</span></>
      )}
    </button>
  );
}
