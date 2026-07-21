import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { Header } from "@/components/header";
import { Providers } from "@/components/providers";
import { brand } from "@/lib/brand";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-body" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  applicationName: brand.productName,
  title: {
    default: `${brand.productName} — Crosschain USDC checkout`,
    template: `%s · ${brand.productName}`,
  },
  description: brand.shortDescription,
  openGraph: {
    type: "website",
    title: `${brand.productName} — Crosschain USDC checkout`,
    description: brand.shortDescription,
    siteName: brand.productName,
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.productName} — Crosschain USDC checkout`,
    description: brand.shortDescription,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce-based CSP requires request-time rendering so Next.js can attach the
  // per-request nonce from proxy.ts to every framework and application script.
  await connection();

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${manrope.variable} ${space.variable}`}>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer>
            <div>
              <span className="brand compact">
                <BrandMark className="brand-mark" />
                {brand.productName}
              </span>
              <p>{brand.shortDescription}</p>
              <small>{brand.legalDisclaimer}</small>
            </div>
            <div className="footer-links">
              <a href="/proof">Proof of Build</a>
              <a href="/proof#contracts">Contracts</a>
              <a
                href="https://github.com/hitmol/Arc-Crosschain-Checkout"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <span>{brand.infrastructureAttribution}</span>
              <span>{brand.protocolAttribution}</span>
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
