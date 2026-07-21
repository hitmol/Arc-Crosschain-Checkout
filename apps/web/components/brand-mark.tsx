import type { SVGProps } from "react";

export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 32 32"
      {...props}
    >
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M8 9.5h5.3c2.1 0 3.8 1.7 3.8 3.8v5.4c0 2.1 1.7 3.8 3.8 3.8H24"
        stroke="var(--brand-mark-route, #fff)"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M8 22.5h3.2c3.3 0 5.9-2.6 5.9-5.9v-3.3"
        stroke="var(--brand-mark-accent, #ff9a6c)"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <circle cx="8" cy="9.5" r="2" fill="var(--brand-mark-accent, #ff9a6c)" />
      <circle cx="8" cy="22.5" r="2" fill="var(--brand-mark-route, #fff)" />
      <circle cx="24" cy="22.5" r="2" fill="var(--brand-mark-route, #fff)" />
    </svg>
  );
}
