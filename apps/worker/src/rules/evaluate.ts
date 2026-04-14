import {
  RuleResultSchema,
  type AnalyzeRequest,
  type RuleResult,
  type StatusCode,
} from "@acai/shared";
import { cycleLabelMap, highVolatilityThemes, requiredFieldKeys, targetReturnThresholdMap } from "./config";

function detectMissingFields(request: AnalyzeRequest): string[] {
  const missing = requiredFieldKeys.filter((key) => {
    const value = request[key];
    if (typeof value === "number") {
      return Number.isNaN(value);
    }

    return value === undefined || value === null;
  });

  if (request.industry_preference.length === 0) {
    missing.push("industry_preference");
  }

  return missing;
}

function computeThresholdContext(request: AnalyzeRequest) {
  const baseThreshold = targetReturnThresholdMap[request.investment_cycle];
  const adjustedThreshold = request.volatility_acceptance ? baseThreshold * 1.5 : baseThreshold;
  const targetReturnIsTooHigh = request.target_return_reference > adjustedThreshold;

  return {
    base_target_return_threshold: baseThreshold,
    adjusted_target_return_threshold: adjustedThreshold,
    target_return_is_too_high: targetReturnIsTooHigh,
  };
}

function hasHighVolatilityTheme(request: AnalyzeRequest): boolean {
  return request.industry_preference.some((topic) =>
    highVolatilityThemes.some((keyword) => topic.includes(keyword)),
  );
}

function buildConflictReasons(request: AnalyzeRequest, targetReturnIsTooHigh: boolean): string[] {
  const reasons: string[] = [];
  const includesHighVolatilityTheme = hasHighVolatilityTheme(request);

  if (request.risk_tolerance === "MAX_DRAWDOWN_5" && request.style_preference === "THEMATIC") {
    reasons.push("可接受最大回撤 5% 与题材风格偏好存在明显冲突。");
  }

  if (request.volatility_acceptance === false && targetReturnIsTooHigh) {
    reasons.push("不接受高波动与当前目标收益之间存在明显张力。");
  }

  if (
    request.investment_cycle === "ONE_WEEK" &&
    request.style_preference === "VALUE" &&
    request.target_return_reference > targetReturnThresholdMap.ONE_WEEK
  ) {
    reasons.push("一周周期下选择价值风格并追求高收益，难以形成稳定筛选条件。");
  }

  if (
    request.risk_tolerance === "MAX_DRAWDOWN_5" &&
    request.style_preference === "THEMATIC" &&
    includesHighVolatilityTheme
  ) {
    reasons.push("低回撤要求与高波动主题偏好组合冲突。");
  }

  if (
    request.volatility_acceptance === false &&
    includesHighVolatilityTheme &&
    (request.investment_cycle === "ONE_WEEK" ||
      request.investment_cycle === "ONE_MONTH" ||
      request.risk_tolerance === "MAX_DRAWDOWN_5" ||
      targetReturnIsTooHigh ||
      request.style_preference === "THEMATIC")
  ) {
    reasons.push("当前方向偏好包含高波动主题，与低波动约束不相容。");
  }

  return reasons;
}

function buildSuggestions(statusCode: StatusCode, request: AnalyzeRequest): string[] {
  if (statusCode === "INSUFFICIENT_INFO") {
    return ["请补充完整预算、风险承受、投资周期和方向偏好后再提交。"];
  }

  if (statusCode === "TARGET_TOO_HIGH_OR_CONFLICT") {
    return [
      `建议先将${cycleLabelMap[request.investment_cycle]}周期下的目标收益参考调整到更接近合理阈值。`,
      "也可以提高可接受回撤或放宽高波动接受度后重新分析。",
    ];
  }

  return [
    "当前规则校验已通过，可以进入公开信息检索和来源验证阶段。",
    "下一步将优先使用一级来源做候选验证。",
  ];
}

export function evaluateRules(request: AnalyzeRequest): RuleResult {
  const missingFields = detectMissingFields(request);
  const thresholdContext = computeThresholdContext(request);
  const matchedRuleKeys: string[] = [];

  if (missingFields.length > 0) {
    matchedRuleKeys.push("missing_required_fields");
    return RuleResultSchema.parse({
      passed: false,
      status_code: "INSUFFICIENT_INFO",
      reasons: ["当前请求信息不足，系统暂不进入公开信息检索。"],
      suggestions: buildSuggestions("INSUFFICIENT_INFO", request),
      missing_fields: missingFields,
      missing_evidence: [],
      rules_passed: false,
      matched_rule_keys: matchedRuleKeys,
      threshold_context: thresholdContext,
    });
  }

  const tooHighReasons: string[] = [];
  if (thresholdContext.target_return_is_too_high) {
    matchedRuleKeys.push("target_return_too_high");
    tooHighReasons.push(
      `${cycleLabelMap[request.investment_cycle]}周期下 ${request.target_return_reference}% 的目标收益高于当前合理阈值。`,
    );
  }

  const conflictReasons = buildConflictReasons(
    request,
    thresholdContext.target_return_is_too_high,
  );

  if (conflictReasons.length > 0 || tooHighReasons.length > 0) {
    if (conflictReasons.length > 0) {
      matchedRuleKeys.push("condition_conflict");
    }

    return RuleResultSchema.parse({
      passed: false,
      status_code: "TARGET_TOO_HIGH_OR_CONFLICT",
      reasons: [...tooHighReasons, ...conflictReasons],
      suggestions: buildSuggestions("TARGET_TOO_HIGH_OR_CONFLICT", request),
      missing_fields: [],
      missing_evidence: [],
      rules_passed: false,
      matched_rule_keys: matchedRuleKeys,
      threshold_context: thresholdContext,
    });
  }

  matchedRuleKeys.push("rules_passed");
  return RuleResultSchema.parse({
    passed: true,
    status_code: "HAS_CANDIDATES",
    reasons: ["你的条件未出现明显冲突，因此系统允许进入公开信息检索阶段。"],
    suggestions: buildSuggestions("HAS_CANDIDATES", request),
    missing_fields: [],
    missing_evidence: [],
    rules_passed: true,
    matched_rule_keys: matchedRuleKeys,
    threshold_context: thresholdContext,
  });
}
