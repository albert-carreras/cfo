"use client";

import { useState } from "react";
import { Icon } from "./icons";

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
    <button type="button" className="tool" onClick={copy}>
      <Icon name="copy" className="i-copy" />
      <span aria-live="polite">{label}</span>
    </button>
  );
}
