import Link from "next/link";
import { WalletButton } from "./wallet-button";
import { BrandMark } from "./brand-mark";
import { brand } from "@/lib/brand";

export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <BrandMark className="brand-mark" />
        <span>{brand.productName}</span>
      </Link>
      <nav aria-label="Primary" className="desktop-nav">
        <Link href="/invoices/new">Create Invoice</Link>
        <Link href="/dashboard">Builder Console</Link>
        <Link href="/proof">Proof of Build</Link>
        <Link href="/proof#contracts">Contracts</Link>
        <Link href="/docs">Docs</Link>
        <a
          href="https://github.com/hitmol/Arc-Crosschain-Checkout"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </nav>
      <details className="mobile-nav">
        <summary>Menu</summary>
        <nav aria-label="Mobile primary">
          <Link href="/invoices/new">Create Invoice</Link>
          <Link href="/dashboard">Builder Console</Link>
          <Link href="/proof">Proof of Build</Link>
          <Link href="/proof#contracts">Contracts</Link>
          <Link href="/docs">Docs</Link>
          <a
            href="https://github.com/hitmol/Arc-Crosschain-Checkout"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </details>
      <WalletButton />
    </header>
  );
}
