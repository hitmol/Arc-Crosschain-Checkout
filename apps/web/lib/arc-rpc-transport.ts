type RpcRequest = {
  method: string;
  params?: readonly unknown[];
};

type RpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type RpcResponse = {
  result?: unknown;
  error?: RpcError;
};

let requestId = 0;

export const arcRpcProxyProvider = {
  async request({ method, params }: RpcRequest): Promise<unknown> {
    const response = await fetch("/api/arc-rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method,
        params: params ?? [],
      }),
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as RpcResponse;
    if (!response.ok || payload.error) {
      const error = new Error(
        payload.error?.message ?? `Arc RPC proxy returned HTTP ${response.status}`,
      );
      Object.assign(error, {
        code: payload.error?.code ?? response.status,
        data: payload.error?.data,
      });
      throw error;
    }
    return payload.result;
  },
};
