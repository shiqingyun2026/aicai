import { RuleResultSchema, type AnalyzeRequest, type RuleResult } from "@acai/shared";

export function runMockSearchStage(
  request: AnalyzeRequest,
  ruleResult: RuleResult,
): RuleResult {
  if (!ruleResult.rules_passed) {
    return ruleResult;
  }

  if (
    request.style_preference === "THEMATIC" ||
    (request.industry_preference.length > 0 &&
      request.industry_preference.every((item) => item.includes("主题")))
  ) {
    return RuleResultSchema.parse({
      ...ruleResult,
      status_code: "NO_CLEAR_CANDIDATES",
      reasons: [
        "规则校验通过，但当前公开信息条件下仍未形成证据足够扎实的明确候选。",
      ],
      suggestions: [
        "可以缩窄行业范围，优先选择经营披露更充分的方向后再试一次。",
        "也可以保留当前条件，等待后续接入更多轮次搜索与证据验证。",
      ],
      missing_evidence: ["一级与二级来源中的经营连续性和分红支撑仍不够充分。"],
      matched_rule_keys: [...ruleResult.matched_rule_keys, "mock_search_no_clear_candidates"],
    });
  }

  return ruleResult;
}

