"use client";

import { useState } from "react";

// The Markdown context pack controls. Copy is the everyday path — paste
// straight into a ChatGPT/Claude chat; the label flips to "Copied" briefly on
// success. The quiet download link covers the rarer case of uploading the file
// into a persistent project as knowledge. Both hit the same /api/export.
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
    <div className="flex items-center gap-3">
      <button type="button" className="button-secondary" onClick={copy}>
        {copied ? "Copied" : "Copy brief"}
      </button>
      <a href="/api/export" download className="button-quiet">
        Download .md
      </a>
    </div>
  );
}
