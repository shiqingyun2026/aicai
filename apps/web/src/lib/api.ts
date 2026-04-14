import type { AnalyzeErrorCode, AnalyzeErrorResponse, AnalyzeRequest, AnalyzeSuccessResponse } from "@acai/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8787";

export class AnalyzeApiError extends Error {
  code?: AnalyzeErrorCode;
  details: AnalyzeErrorResponse["error"]["details"];

  constructor(
    message: string,
    options: {
      code?: AnalyzeErrorCode;
      details?: AnalyzeErrorResponse["error"]["details"];
    } = {},
  ) {
    super(message);
    this.name = "AnalyzeApiError";
    this.code = options.code;
    this.details = options.details ?? [];
  }
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeSuccessResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const payload = (await response.json()) as AnalyzeSuccessResponse | AnalyzeErrorResponse;

  if (!response.ok) {
    const errorPayload = payload as AnalyzeErrorResponse;
    const message = errorPayload?.error?.message || "分析请求失败";
    throw new AnalyzeApiError(message, {
      code: errorPayload?.error?.code,
      details: errorPayload?.error?.details,
    });
  }

  return payload as AnalyzeSuccessResponse;
}
