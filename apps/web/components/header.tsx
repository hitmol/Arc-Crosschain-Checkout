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
      <nav aria-label="Primary">
        <Link href="/proof">Proof of Build</Link>
        <Link href="/proof#contracts">Contracts</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/docs">Docs</Link>
        <a
          href="https://github.com/hitmol/Arc-Crosschain-Checkout"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </nav>
      <WalletButton />
    </header>
  );
}
