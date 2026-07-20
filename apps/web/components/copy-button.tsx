"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className="icon-button print-hidden"
      onClick={() => void copy()}
      title={`Copy ${label}`}
      type="button"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
