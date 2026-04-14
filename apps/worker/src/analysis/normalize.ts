import {
  AnalyzeRequestSchema,
  normalizeIndustryPreference,
  type AnalyzeRequest,
} from "@acai/shared";

export function normalizeAnalyzeRequest(input: unknown): AnalyzeRequest {
  const parsed = AnalyzeRequestSchema.parse(input);

  return {
    ...parsed,
    industry_preference: normalizeIndustryPreference(parsed.industry_preference),
  };
}

