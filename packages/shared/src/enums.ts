export const riskToleranceValues = [
  "MAX_DRAWDOWN_5",
  "MAX_DRAWDOWN_10",
  "MAX_DRAWDOWN_20",
  "MAX_DRAWDOWN_50",
] as const;

export const investmentCycleValues = [
  "ONE_WEEK",
  "ONE_MONTH",
  "ONE_QUARTER",
  "HALF_YEAR",
  "ONE_YEAR",
  "TWO_YEARS",
  "OVER_THREE_YEARS",
] as const;

export const stylePreferenceValues = [
  "VALUE",
  "GROWTH",
  "DIVIDEND",
  "LEADER",
  "THEMATIC",
  "BALANCED",
] as const;

export const statusCodeValues = [
  "INSUFFICIENT_INFO",
  "TARGET_TOO_HIGH_OR_CONFLICT",
  "NO_CLEAR_CANDIDATES",
  "HAS_CANDIDATES",
] as const;

export const confidenceLevelValues = ["HIGH", "MEDIUM", "LOW"] as const;
export const sourceLevelValues = ["L1", "L2", "L3", "L4"] as const;

export const analyzeErrorCodeValues = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "UPSTREAM_FAILURE",
  "INTERNAL_ERROR",
] as const;

