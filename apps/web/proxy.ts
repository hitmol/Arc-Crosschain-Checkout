import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  let apiOrigin = "";
  try {
    apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "").origin;
  } catch {
    // A missing URL is validated by the production deployment gate.
  }
  const scriptSrc = development
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://explorer-api.walletconnect.com",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} https://iris-api-sandbox.circle.com https://rpc.testnet.arc.network https://sepolia.base.org https://ethereum-sepolia-rpc.publicnode.com wss://rpc.testnet.arc.network https://relay.walletconnect.com wss://relay.walletconnect.com https://rpc.walletconnect.com https://pulse.walletconnect.org https://verify.walletconnect.com https://explorer-api.walletconnect.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
