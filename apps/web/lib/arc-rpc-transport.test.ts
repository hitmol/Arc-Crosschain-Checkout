import { afterEach, describe, expect, it, vi } from "vitest";
import { arcRpcProxyProvider } from "./arc-rpc-transport";

describe("Arc RPC browser transport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the same-origin proxy and returns the JSON-RPC result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      arcRpcProxyProvider.request({ method: "eth_chainId", params: [] }),
    ).resolves.toBe("0x4cef52");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/arc-rpc",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
  });

  it("surfaces JSON-RPC errors to viem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"upstream unavailable"}}',
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      arcRpcProxyProvider.request({ method: "eth_chainId", params: [] }),
    ).rejects.toMatchObject({ message: "upstream unavailable", code: -32000 });
  });
});
