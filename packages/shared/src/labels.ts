import type { InvestmentCycle, RiskTolerance, StatusCode, StylePreference } from "./types";

export const statusLabelMap: Record<StatusCode, string> = {
  INSUFFICIENT_INFO: "信息不足",
  TARGET_TOO_HIGH_OR_CONFLICT: "目标偏高或条件冲突",
  NO_CLEAR_CANDIDATES: "暂无明确候选",
  HAS_CANDIDATES: "已有候选",
};

export const riskToleranceLabelMap: Record<RiskTolerance, string> = {
  MAX_DRAWDOWN_5: "可接受最大回撤 5%",
  MAX_DRAWDOWN_10: "可接受最大回撤 10%",
  MAX_DRAWDOWN_20: "可接受最大回撤 20%",
  MAX_DRAWDOWN_50: "可接受最大回撤 50%",
};

export const investmentCycleLabelMap: Record<InvestmentCycle, string> = {
  ONE_WEEK: "一周",
  ONE_MONTH: "一个月",
  ONE_QUARTER: "一季度",
  HALF_YEAR: "半年",
  ONE_YEAR: "一年",
  TWO_YEARS: "两年",
  OVER_THREE_YEARS: "三年以上",
};

export const stylePreferenceLabelMap: Record<StylePreference, string> = {
  VALUE: "价值",
  GROWTH: "成长",
  DIVIDEND: "红利",
  LEADER: "龙头",
  THEMATIC: "主题",
  BALANCED: "均衡",
};

