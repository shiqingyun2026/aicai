import {
  highVolatilityThemes,
  targetReturnThresholdMap,
  type AnalyzeRequest,
  type InvestmentCycle,
} from "@acai/shared";

export const requiredFieldKeys: Array<keyof AnalyzeRequest> = [
  "budget",
  "target_return_reference",
  "risk_tolerance",
  "investment_cycle",
  "volatility_acceptance",
];

export const cycleLabelMap: Record<InvestmentCycle, string> = {
  ONE_WEEK: "一周",
  ONE_MONTH: "一个月",
  ONE_QUARTER: "一个季度",
  HALF_YEAR: "半年",
  ONE_YEAR: "一年",
  TWO_YEARS: "两年",
  OVER_THREE_YEARS: "三年以上",
};

export { highVolatilityThemes, targetReturnThresholdMap };

