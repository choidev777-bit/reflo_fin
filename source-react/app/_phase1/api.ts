export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details: Array<{ path: string; code: string; message: string }>;
    meta: Record<string, unknown>;
  };
};

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error.message);
  }
}

export async function apiJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {
        error: {
          code: "NETWORK_RESPONSE_INVALID",
          message: "서버 응답을 확인할 수 없습니다.",
          requestId: "",
          retryable: true,
          details: [],
          meta: {},
        },
      };
    }
    throw new ClientApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function googleLoginUrl(returnTo: string, intent?: "projects" | "create-project") {
  const params = new URLSearchParams({ returnTo });
  if (intent) params.set("intent", intent);
  return `/api/auth/google/start?${params.toString()}`;
}
