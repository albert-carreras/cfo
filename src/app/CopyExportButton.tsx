"use client";

import { useState } from "react";

// Copies the Markdown context pack to the clipboard so it can be pasted
// straight into a ChatGPT/Claude project, alongside the download link. The
// label flips to "Copied" briefly on success.
export function CopyExportButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const res = await fetch("/api/export");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked or the export failed; leave the label unchanged.
    }
  }

  return (
    <button type="button" className="button-secondary" onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
