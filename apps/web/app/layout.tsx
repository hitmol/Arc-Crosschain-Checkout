import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-body" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "Arc Crosschain Checkout", template: "%s · Arc Checkout" },
  description:
    "Accept USDC from multiple chains through one payment link and settle every invoice on Arc.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${manrope.variable} ${space.variable}`}>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer>
            <div>
              <span className="brand compact">
                <span className="brand-mark">A</span>Arc Checkout
              </span>
              <p>
                Non-custodial USDC checkout. Testnet software — not audited for
                production.
              </p>
            </div>
            <div className="footer-links">
              <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
                Arc docs
              </a>
              <a
                href="https://developers.circle.com/cctp"
                target="_blank"
                rel="noreferrer"
              >
                CCTP docs
              </a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
