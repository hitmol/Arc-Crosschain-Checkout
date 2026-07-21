import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function rpcRequest(
  body: unknown,
  origin = "https://arc-crosschain-checkout.vercel.app",
) {
  return new NextRequest(
    "https://arc-crosschain-checkout.vercel.app/api/arc-rpc",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

describe("Arc RPC fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards allowlisted read methods without credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await POST(
      rpcRequest({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "0x4cef52",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rpc.testnet.arc.network",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
      }),
    );
  });

  it("rejects wallet write methods", async () => {
    const response = await POST(
      rpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: ["0xdeadbeef"],
      }),
    );
    expect(response.status).toBe(400);
    expect(vi.spyOn(globalThis, "fetch")).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(
      rpcRequest(
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        "https://example.com",
      ),
    );
    expect(response.status).toBe(403);
  });
});
