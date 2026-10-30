"use client";

import { useState } from "react";

// Copies the Markdown brief, ready to paste into a ChatGPT/Claude chat.
export function CopyBrief() {
  const [label, setLabel] = useState("Copy for AI");
  async function copy() {
    try {
      const res = await fetch("/api/export");
      await navigator.clipboard.writeText(await res.text());
      setLabel("Copied");
    } catch {
      setLabel("Couldn't copy");
    }
    setTimeout(() => setLabel("Copy for AI"), 2000);
  }
  return (
    <button type="button" className="btn btn-small" onClick={copy}>
      {label}
    </button>
  );
}
