import {
  AnalyzeRequestSchema,
  type AnalyzeErrorCode,
  type AnalyzeErrorResponse,
} from "@acai/shared";
import { z } from "zod";
import { normalizeAnalyzeRequest } from "./analysis/normalize";
import { composeAnalyzeResponse } from "./analysis/resultComposer";
import { createPreflightResponse, jsonResponse } from "./lib/http";
import { makeId, makeUuid } from "./lib/ids";
import { runResponsesPipeline } from "./responses/orchestrator";
import { evaluateRules } from "./rules/evaluate";
import { persistAnalysisBundle } from "./storage/analysisRecords";
import { hasDatabaseBinding } from "./storage/client";
import type { WorkerEnv } from "./storage/types";

function buildErrorResponse(
  code: AnalyzeErrorCode,
  message: string,
  details: AnalyzeErrorResponse["error"]["details"] = [],
): AnalyzeErrorResponse {
  return {
    request_id: makeId("req"),
    error: {
      code,
      message,
      details,
    },
  };
}

function buildErrorPayload(
  requestId: string,
  code: AnalyzeErrorCode,
  message: string,
  details: AnalyzeErrorResponse["error"]["details"] = [],
): AnalyzeErrorResponse {
  return {
    request_id: requestId,
    error: {
      code,
      message,
      details,
    },
  };
}

function buildValidationError(error: z.ZodError): AnalyzeErrorResponse {
  return buildErrorResponse(
    "INVALID_REQUEST",
    "请求参数不合法",
    error.issues.map((issue) => ({
      field: issue.path.join(".") || "request",
      reason: issue.message,
    })),
  );
}

async function handleAnalyze(request: Request, env: WorkerEnv): Promise<Response> {
  const startedAt = Date.now();
  const requestId = makeId("req");
  const analysisId = makeUuid();
  const headerSessionId = request.headers.get("x-client-session-id");
  const clientSessionId =
    headerSessionId && /^[0-9a-f-]{36}$/i.test(headerSessionId) ? headerSessionId : makeUuid();
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      buildErrorPayload(requestId, "INVALID_REQUEST", "请求体必须是合法 JSON", [
        { field: "request", reason: "invalid_json" },
      ]),
      400,
    );
  }

  const validated = AnalyzeRequestSchema.safeParse(payload);
  if (!validated.success) {
    return jsonResponse(buildErrorPayload(requestId, "INVALID_REQUEST", "请求参数不合法", buildValidationError(validated.error).error.details), 400);
  }

  const normalizedRequest = normalizeAnalyzeRequest(validated.data);
  const ruleResult = evaluateRules(normalizedRequest);
  const pipelineResult = ruleResult.rules_passed
    ? await runResponsesPipeline(normalizedRequest)
    : undefined;
  const durationMs = Date.now() - startedAt;
  const response = composeAnalyzeResponse({
    analysisId,
    clientSessionId,
    normalizedRequest,
    pipelineResult,
    requestId,
    ruleResult,
    durationMs,
  });

  if (hasDatabaseBinding(env)) {
    try {
      await persistAnalysisBundle(env, {
        analysisId,
        requestId,
        clientSessionId,
        processingState: "completed",
        statusCode: response.status_code,
        statusLabel: response.status_label,
        rulesPassed: ruleResult.rules_passed,
        ruleStatusCode: ruleResult.status_code,
        normalizedRequest,
        ruleResults: {
          initial_rule_result: ruleResult,
          pipeline_result: pipelineResult ?? null,
        },
        roundTrace:
          pipelineResult?.roundTrace ?? {
            rounds: [],
            stage: "rules_only",
          },
        finalResponse: response,
        finalResponseTyped: response,
        searchRoundsUsed: response.meta.search_rounds_used,
        durationMs,
      });
    } catch (error) {
      console.error("persist_analysis_record_failed", error);
      return jsonResponse(
        buildErrorPayload(requestId, "INTERNAL_ERROR", "分析记录写入失败", [
          { field: "storage", reason: "persist_analysis_record_failed" },
        ]),
        500,
      );
    }
  }

  return jsonResponse(response);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return createPreflightResponse();
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "acai-worker",
        time: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/analyze") {
      return handleAnalyze(request, env);
    }

    return jsonResponse(
      buildErrorResponse("INTERNAL_ERROR", "未找到对应接口", [
        { field: "path", reason: url.pathname },
      ]),
      404,
    );
  },
};
