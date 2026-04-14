import {
  AnalyzeSuccessResponseSchema,
  buildConditionSummary,
  defaultOverallNote,
  riskNotice,
  statusLabelMap,
  type AnalyzeRequest,
  type AnalyzeSuccessResponse,
  type RuleResult,
} from "@acai/shared";
import type { ResponsesPipelineResult } from "../responses/types";

type ComposeOptions = {
  analysisId: string;
  clientSessionId: string;
  requestId: string;
  ruleResult: RuleResult;
  pipelineResult?: ResponsesPipelineResult;
  normalizedRequest: AnalyzeRequest;
  durationMs: number;
};

export function composeAnalyzeResponse(options: ComposeOptions): AnalyzeSuccessResponse {
  const {
    analysisId,
    clientSessionId,
    normalizedRequest,
    pipelineResult,
    requestId,
    ruleResult,
    durationMs,
  } = options;
  const statusCode = pipelineResult?.statusCode ?? ruleResult.status_code;
  const hasCandidates = statusCode === "HAS_CANDIDATES";
  const canSearch = ruleResult.rules_passed;
  const noClearCandidates = statusCode === "NO_CLEAR_CANDIDATES";

  const response: AnalyzeSuccessResponse = {
    request_id: requestId,
    analysis_id: analysisId,
    client_session_id: clientSessionId,
    status_code: statusCode,
    status_label: statusLabelMap[statusCode],
    condition_summary: buildConditionSummary(normalizedRequest),
    analysis: {
      reasons: pipelineResult?.reasons ?? ruleResult.reasons,
      suggestions: pipelineResult?.suggestions ?? ruleResult.suggestions,
      overall_note: pipelineResult?.overallNote ?? defaultOverallNote,
      missing_fields: ruleResult.missing_fields,
      missing_evidence: pipelineResult?.missingEvidence ?? ruleResult.missing_evidence,
    },
    candidates: hasCandidates ? pipelineResult?.candidates ?? [] : [],
    risk_notice: riskNotice,
    meta: {
      rules_passed: ruleResult.rules_passed,
      search_rounds_used: canSearch ? (pipelineResult?.searchRoundsUsed ?? 1) : 0,
      highest_source_level_used_for_core_conclusion:
        pipelineResult?.highestSourceLevelUsedForCoreConclusion ?? null,
      duration_ms: durationMs,
      generated_at: new Date().toISOString(),
    },
  };

  if (noClearCandidates) {
    response.meta.highest_source_level_used_for_core_conclusion = null;
  }

  return AnalyzeSuccessResponseSchema.parse(response);
}
