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
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/invoices/new">Create invoice</Link>
        <Link href="/docs">Docs</Link>
      </nav>
      <WalletButton />
    </header>
  );
}
