import type { InvestmentCycle } from "./types";

export const targetReturnThresholdMap: Record<InvestmentCycle, number> = {
  ONE_WEEK: 5,
  ONE_MONTH: 8,
  ONE_QUARTER: 12,
  HALF_YEAR: 15,
  ONE_YEAR: 20,
  TWO_YEARS: 25,
  OVER_THREE_YEARS: 30,
};

export const highVolatilityThemes = [
  "低空经济",
  "飞行汽车",
  "商业航天",
  "卫星互联网",
  "机器人",
  "人形机器人",
  "AI 应用",
] as const;

