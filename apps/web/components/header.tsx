import Link from "next/link";
import { WalletButton } from "./wallet-button";

export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-mark">A</span>
        <span>Arc Checkout</span>
      </Link>
      <nav aria-label="Primary">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/invoices/new">Create invoice</Link>
        <Link href="/docs">Docs</Link>
      </nav>
      <WalletButton />
    </header>
  );
}
