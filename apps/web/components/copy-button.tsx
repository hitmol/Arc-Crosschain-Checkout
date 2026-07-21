"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function copyButtonAccessibleLabel(label: string) {
  const normalizedLabel = label.replace(/^copy\s+/i, "").trim();
  return `Copy ${normalizedLabel.charAt(0).toLowerCase()}${normalizedLabel.slice(1)}`;
}

export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const accessibleLabel = copyButtonAccessibleLabel(label);

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
      aria-label={accessibleLabel}
      className="icon-button print-hidden"
      onClick={() => void copy()}
      title={accessibleLabel}
      type="button"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
