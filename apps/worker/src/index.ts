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
import {
  ResponsesProviderConfigurationError,
  resolveResponsesProvider,
} from "./responses/providers";
import { evaluateRules } from "./rules/evaluate";
import { persistAnalysisBundle, persistFailedAnalysisRecord } from "./storage/analysisRecords";
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

function buildFallbackAnalyzeRequest(
  payload: unknown,
): ReturnType<typeof normalizeAnalyzeRequest> {
  const input = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  return normalizeAnalyzeRequest({
    budget: typeof input.budget === "number" ? input.budget : 0,
    target_return_reference:
      typeof input.target_return_reference === "number" ? input.target_return_reference : 0,
    risk_tolerance:
      input.risk_tolerance === "MAX_DRAWDOWN_5" ||
      input.risk_tolerance === "MAX_DRAWDOWN_10" ||
      input.risk_tolerance === "MAX_DRAWDOWN_20" ||
      input.risk_tolerance === "MAX_DRAWDOWN_50"
        ? input.risk_tolerance
        : "MAX_DRAWDOWN_10",
    investment_cycle:
      input.investment_cycle === "ONE_WEEK" ||
      input.investment_cycle === "ONE_MONTH" ||
      input.investment_cycle === "ONE_QUARTER" ||
      input.investment_cycle === "HALF_YEAR" ||
      input.investment_cycle === "ONE_YEAR" ||
      input.investment_cycle === "TWO_YEARS" ||
      input.investment_cycle === "OVER_THREE_YEARS"
        ? input.investment_cycle
        : "ONE_YEAR",
    volatility_acceptance:
      typeof input.volatility_acceptance === "boolean" ? input.volatility_acceptance : false,
    industry_preference: Array.isArray(input.industry_preference)
      ? input.industry_preference.filter((item): item is string => typeof item === "string")
      : [],
    style_preference:
      input.style_preference === "VALUE" ||
      input.style_preference === "GROWTH" ||
      input.style_preference === "DIVIDEND" ||
      input.style_preference === "LEADER" ||
      input.style_preference === "THEMATIC" ||
      input.style_preference === "BALANCED"
        ? input.style_preference
        : "BALANCED",
  });
}

async function persistFailedAttempt(
  env: WorkerEnv,
  input: {
    analysisId: string;
    requestId: string;
    clientSessionId: string;
    normalizedRequest: ReturnType<typeof normalizeAnalyzeRequest>;
    ruleResult: ReturnType<typeof evaluateRules>;
    durationMs: number;
    errorCode: AnalyzeErrorCode;
    errorMessage: string;
    roundTrace?: Record<string, unknown>;
    ruleResults?: Record<string, unknown>;
  },
): Promise<void> {
  if (!hasDatabaseBinding(env)) {
    return;
  }

  await persistFailedAnalysisRecord(env, {
    analysisId: input.analysisId,
    requestId: input.requestId,
    clientSessionId: input.clientSessionId,
    processingState: "failed",
    statusCode: null,
    statusLabel: null,
    rulesPassed: input.ruleResult.rules_passed,
    ruleStatusCode: input.ruleResult.status_code,
    normalizedRequest: input.normalizedRequest,
    ruleResults:
      input.ruleResults ?? {
        initial_rule_result: input.ruleResult,
      },
    roundTrace: input.roundTrace ?? {
      rounds: [],
      stage: "failed_before_pipeline_completion",
    },
    finalResponse: {
      error: {
        code: input.errorCode,
        message: input.errorMessage,
      },
    },
    searchRoundsUsed: 0,
    durationMs: input.durationMs,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  });
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
    const fallbackRequest = buildFallbackAnalyzeRequest({});
    const errorPayload = buildErrorPayload(requestId, "INVALID_REQUEST", "请求体必须是合法 JSON", [
      { field: "request", reason: "invalid_json" },
    ]);

    try {
      await persistFailedAttempt(env, {
        analysisId,
        requestId,
        clientSessionId,
        normalizedRequest: fallbackRequest,
        ruleResult: evaluateRules(fallbackRequest),
        durationMs: Date.now() - startedAt,
        errorCode: "INVALID_REQUEST",
        errorMessage: "invalid_json",
        ruleResults: {
          initial_rule_result: null,
          validation_error: errorPayload.error,
          raw_payload: null,
        },
      });
    } catch (persistError) {
      console.error("persist_failed_analysis_record_failed", persistError);
    }

    return jsonResponse(
      errorPayload,
      400,
    );
  }

  const validated = AnalyzeRequestSchema.safeParse(payload);
  if (!validated.success) {
    const errorPayload = buildErrorPayload(
      requestId,
      "INVALID_REQUEST",
      "请求参数不合法",
      buildValidationError(validated.error).error.details,
    );
    const fallbackRequest = buildFallbackAnalyzeRequest(payload);

    try {
      await persistFailedAttempt(env, {
        analysisId,
        requestId,
        clientSessionId,
        normalizedRequest: fallbackRequest,
        ruleResult: evaluateRules(fallbackRequest),
        durationMs: Date.now() - startedAt,
        errorCode: "INVALID_REQUEST",
        errorMessage: "invalid_request_payload",
        ruleResults: {
          initial_rule_result: null,
          validation_error: errorPayload.error,
          raw_payload: payload,
        },
      });
    } catch (persistError) {
      console.error("persist_failed_analysis_record_failed", persistError);
    }

    return jsonResponse(
      errorPayload,
      400,
    );
  }

  const normalizedRequest = normalizeAnalyzeRequest(validated.data);
  const ruleResult = evaluateRules(normalizedRequest);

  if (ruleResult.rules_passed) {
    let pipelineResult;
    try {
      pipelineResult = await runResponsesPipeline(
        normalizedRequest,
        resolveResponsesProvider(env),
      );
    } catch (error) {
      console.error("responses_pipeline_failed", error);
      const isConfigurationError = error instanceof ResponsesProviderConfigurationError;
      const errorMessage =
        error instanceof Error ? error.message : "responses_pipeline_failed";
      const errorCode: AnalyzeErrorCode = isConfigurationError
        ? "INTERNAL_ERROR"
        : "UPSTREAM_FAILURE";
      const responseMessage = isConfigurationError
        ? "Responses Provider 配置缺失"
        : "上游模型调用失败";
      const responseStatus = isConfigurationError ? 500 : 502;
      try {
        await persistFailedAttempt(env, {
          analysisId,
          requestId,
          clientSessionId,
          normalizedRequest,
          ruleResult,
          durationMs: Date.now() - startedAt,
          errorCode,
          errorMessage,
          ruleResults: {
            initial_rule_result: ruleResult,
            pipeline_result: null,
          },
        });
      } catch (persistError) {
        console.error("persist_failed_analysis_record_failed", persistError);
      }

      return jsonResponse(
        buildErrorPayload(requestId, errorCode, responseMessage, [
          {
            field: "responses_pipeline",
            reason: errorMessage,
          },
        ]),
        responseStatus,
      );
    }
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

  const durationMs = Date.now() - startedAt;
  const response = composeAnalyzeResponse({
    analysisId,
    clientSessionId,
    normalizedRequest,
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
          pipeline_result: null,
        },
        roundTrace: {
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
