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

export const AnalyzeRequestSchema = z.object({
  budget: z.number().int().positive(),
  target_return_reference: z.number().int().min(0).max(100),
  risk_tolerance: z.enum(riskToleranceValues),
  investment_cycle: z.enum(investmentCycleValues),
  volatility_acceptance: z.boolean(),
  industry_preference: z
    .array(z.string().trim().min(1).max(20))
    .max(8)
    .default([]),
  style_preference: z.enum(stylePreferenceValues).default("BALANCED"),
});

export const ConditionSummaryFieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  label: z.union([z.string(), z.array(z.string())]),
});

export const AnalysisSchema = z.object({
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  overall_note: z.string(),
  missing_fields: z.array(z.string()),
  missing_evidence: z.array(z.string()),
});

export const SourceLinkSchema = z.object({
  evidence_id: z.string(),
  source_level: z.enum(sourceLevelValues),
  source_name: z.string(),
  source_domain: z.string(),
  title: z.string(),
  url: z.string().url(),
  publish_date: z.string(),
  snippet: z.string(),
  is_core_evidence: z.boolean(),
});

export const CandidateSchema = z.object({
  candidate_id: z.string(),
  stock_name: z.string(),
  stock_code: z.string(),
  industry: z.string(),
  selection_reason: z.string(),
  evidence_summary: z.string(),
  major_risks: z.string(),
  uncertainties: z.string(),
  confidence_level: z.enum(confidenceLevelValues),
  confidence_score: z.number().int().min(0).max(100),
  primary_source_levels: z.array(z.enum(sourceLevelValues)),
  source_links: z.array(SourceLinkSchema),
});

export const AnalyzeSuccessResponseSchema = z.object({
  request_id: z.string(),
  analysis_id: z.string(),
  client_session_id: z.string().optional(),
  status_code: z.enum(statusCodeValues),
  status_label: z.string(),
  condition_summary: z.object({
    budget: ConditionSummaryFieldSchema,
    target_return_reference: ConditionSummaryFieldSchema,
    risk_tolerance: ConditionSummaryFieldSchema,
    investment_cycle: ConditionSummaryFieldSchema,
    volatility_acceptance: ConditionSummaryFieldSchema,
    style_preference: ConditionSummaryFieldSchema,
    industry_preference: ConditionSummaryFieldSchema,
  }),
  analysis: AnalysisSchema,
  candidates: z.array(CandidateSchema).max(5),
  risk_notice: z.string(),
  meta: z.object({
    rules_passed: z.boolean(),
    search_rounds_used: z.number().int().min(0).max(4),
    highest_source_level_used_for_core_conclusion: z.enum(sourceLevelValues).nullable(),
    duration_ms: z.number().int().nonnegative(),
    generated_at: z.string(),
  }),
});

export const ErrorDetailSchema = z.object({
  field: z.string(),
  reason: z.string(),
});

export const AnalyzeErrorResponseSchema = z.object({
  request_id: z.string(),
  error: z.object({
    code: z.enum(analyzeErrorCodeValues),
    message: z.string(),
    details: z.array(ErrorDetailSchema).default([]),
  }),
});

export const RuleResultSchema = z.object({
  passed: z.boolean(),
  status_code: z.enum(statusCodeValues),
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  missing_fields: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  rules_passed: z.boolean(),
  matched_rule_keys: z.array(z.string()),
  threshold_context: z.object({
    base_target_return_threshold: z.number().int().nonnegative(),
    adjusted_target_return_threshold: z.number().nonnegative(),
    target_return_is_too_high: z.boolean(),
  }),
});

