import type { AnalyzeRequest, AnalyzeSuccessResponse } from "@acai/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8787";

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeSuccessResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || "分析请求失败";
    throw new Error(message);
  }

  return payload as AnalyzeSuccessResponse;
}

