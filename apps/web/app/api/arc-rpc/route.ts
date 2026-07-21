import { NextResponse, type NextRequest } from "next/server";

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const MAX_BODY_BYTES = 16_384;
const MAX_BATCH_SIZE = 10;
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown[];
};

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    ALLOWED_METHODS.has(request.method) &&
    (request.params === undefined || Array.isArray(request.params)) &&
    (request.id === undefined ||
      request.id === null ||
      typeof request.id === "string" ||
      typeof request.id === "number")
  );
}

function isAllowedPayload(value: unknown): boolean {
  if (Array.isArray(value))
    return (
      value.length > 0 &&
      value.length <= MAX_BATCH_SIZE &&
      value.every(isJsonRpcRequest)
    );
  return isJsonRpcRequest(value);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Origin is not allowed" },
      { status: 403 },
    );

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
    return NextResponse.json(
      { error: "Request is too large" },
      { status: 413 },
    );

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
    return NextResponse.json(
      { error: "Request is too large" },
      { status: 413 },
    );

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isAllowedPayload(payload))
    return NextResponse.json(
      { error: "RPC method or payload is not allowed" },
      { status: 400 },
    );

  try {
    const upstream = await fetch(ARC_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Arc RPC is temporarily unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
