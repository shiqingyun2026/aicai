import { investmentCycleLabelMap, riskToleranceLabelMap, stylePreferenceLabelMap } from "./labels";
import type { AnalyzeRequest, AnalyzeSuccessResponse } from "./types";

export function buildConditionSummary(
  request: AnalyzeRequest,
): AnalyzeSuccessResponse["condition_summary"] {
  return {
    budget: {
      value: request.budget,
      label: `${request.budget.toLocaleString("zh-CN")} 元`,
    },
    target_return_reference: {
      value: request.target_return_reference,
      label: `${request.target_return_reference}%`,
    },
    risk_tolerance: {
      value: request.risk_tolerance,
      label: riskToleranceLabelMap[request.risk_tolerance],
    },
    investment_cycle: {
      value: request.investment_cycle,
      label: investmentCycleLabelMap[request.investment_cycle],
    },
    volatility_acceptance: {
      value: request.volatility_acceptance,
      label: request.volatility_acceptance ? "可以接受" : "尽量不接受",
    },
    style_preference: {
      value: request.style_preference,
      label: stylePreferenceLabelMap[request.style_preference],
    },
    industry_preference: {
      value: request.industry_preference,
      label:
        request.industry_preference.length > 0
          ? request.industry_preference
          : ["不限"],
    },
  };
}

export function normalizeIndustryPreference(input: string[]): string[] {
  return Array.from(
    new Set(
      input
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

