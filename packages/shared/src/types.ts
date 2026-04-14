import { z } from "zod";
import {
  analyzeErrorCodeValues,
  confidenceLevelValues,
  investmentCycleValues,
  riskToleranceValues,
  sourceLevelValues,
  statusCodeValues,
  stylePreferenceValues,
} from "./enums";
import {
  AnalyzeErrorResponseSchema,
  AnalyzeRequestSchema,
  AnalyzeSuccessResponseSchema,
  RuleResultSchema,
} from "./schemas";

export type RiskTolerance = (typeof riskToleranceValues)[number];
export type InvestmentCycle = (typeof investmentCycleValues)[number];
export type StylePreference = (typeof stylePreferenceValues)[number];
export type StatusCode = (typeof statusCodeValues)[number];
export type ConfidenceLevel = (typeof confidenceLevelValues)[number];
export type SourceLevel = (typeof sourceLevelValues)[number];
export type AnalyzeErrorCode = (typeof analyzeErrorCodeValues)[number];

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeSuccessResponse = z.infer<typeof AnalyzeSuccessResponseSchema>;
export type AnalyzeErrorResponse = z.infer<typeof AnalyzeErrorResponseSchema>;
export type RuleResult = z.infer<typeof RuleResultSchema>;

export type ConditionSummary = AnalyzeSuccessResponse["condition_summary"];

