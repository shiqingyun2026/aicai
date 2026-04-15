import { z } from "zod";
import {
  CandidateSchema,
  SourceLinkSchema,
  statusCodeValues,
  confidenceLevelValues,
  sourceLevelValues,
  type AnalyzeRequest,
  type AnalyzeSuccessResponse,
  type SourceLevel,
  type StatusCode,
} from "@acai/shared";

export const CandidateNarrowingSchema = z.object({
  round: z.number().int().min(1).max(4),
  stage: z.literal("candidate_narrowing"),
  allowed_source_levels: z.array(z.enum(sourceLevelValues)),
  candidate_pool: z.array(
    z.object({
      stock_name: z.string(),
      stock_code: z.string(),
      industry: z.string(),
      selection_thesis: z.string(),
      preliminary_match_points: z.array(z.string()).max(5),
    }),
  ).max(12),
  excluded_candidates: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
    }),
  ),
  search_notes: z.array(z.string()).max(5),
});

export const EvidenceVerificationSchema = z.object({
  round: z.number().int().min(1).max(4),
  stage: z.literal("evidence_verification"),
  allowed_source_levels: z.array(z.enum(sourceLevelValues)),
  candidate_evaluations: z.array(
    z.object({
      stock_name: z.string(),
      stock_code: z.string(),
      is_qualified_in_current_round: z.boolean(),
      source_level_coverage: z.array(z.enum(sourceLevelValues)),
      evidence_items: z.array(
        z.object({
          source_level: z.enum(sourceLevelValues),
          source_name: z.string(),
          source_domain: z.string(),
          title: z.string(),
          url: z.string().url(),
          publish_date: z.string(),
          snippet: z.string(),
          supports_core_conclusion: z.boolean(),
        }),
      ).max(10),
      missing_evidence: z.array(z.string()),
      disqualify_reasons: z.array(z.string()),
    }),
  ).max(12),
  evidence_sufficient: z.boolean(),
  missing_evidence: z.array(z.string()),
  should_escalate_to_next_round: z.boolean(),
});

export const StructuredAssessmentSchema = z.object({
  round: z.number().int().min(1).max(4),
  stage: z.literal("structured_assessment"),
  allowed_source_levels: z.array(z.enum(sourceLevelValues)),
  proposed_status: z.enum(statusCodeValues),
  qualified_candidates: z.array(
    z.object({
      stock_name: z.string(),
      stock_code: z.string(),
      industry: z.string(),
      selection_reason: z.string(),
      evidence_summary: z.string(),
      major_risks: z.string(),
      uncertainties: z.string(),
      confidence_level: z.enum(confidenceLevelValues),
      confidence_score: z.number().int().min(0).max(100),
    }),
  ).max(5),
  rejected_candidates: z.array(
    z.object({
      stock_name: z.string(),
      stock_code: z.string(),
      reason: z.string(),
    }),
  ),
  reasons: z.array(z.string()).max(6),
  suggestions: z.array(z.string()).max(6),
  overall_note: z.string(),
  evidence_sufficient: z.boolean(),
  missing_evidence: z.array(z.string()),
  should_escalate_to_next_round: z.boolean(),
});

export type CandidateNarrowingOutput = z.infer<typeof CandidateNarrowingSchema>;
export type EvidenceVerificationOutput = z.infer<typeof EvidenceVerificationSchema>;
export type StructuredAssessmentOutput = z.infer<typeof StructuredAssessmentSchema>;
export type PipelineCandidate = z.infer<typeof CandidateSchema>;
export type PipelineEvidence = z.infer<typeof SourceLinkSchema>;

export type ResponseStageInput = {
  request: AnalyzeRequest;
  round: number;
  allowedSourceLevels: SourceLevel[];
};

export type ResponsesProvider = {
  runCandidateNarrowing(input: ResponseStageInput): Promise<CandidateNarrowingOutput>;
  runEvidenceVerification(
    input: ResponseStageInput & { candidateNarrowing: CandidateNarrowingOutput },
  ): Promise<EvidenceVerificationOutput>;
  runStructuredAssessment(
    input: ResponseStageInput & {
      candidateNarrowing: CandidateNarrowingOutput;
      evidenceVerification: EvidenceVerificationOutput;
    },
  ): Promise<StructuredAssessmentOutput>;
};

export type RoundTraceEntry = {
  round: number;
  allowed_source_levels: SourceLevel[];
  candidate_narrowing: CandidateNarrowingOutput;
  evidence_verification: EvidenceVerificationOutput;
  structured_assessment: StructuredAssessmentOutput;
  gatekeeper?: {
    evidence_sufficient: boolean;
    should_escalate_to_next_round: boolean;
    missing_evidence: string[];
    rejected_candidates: Array<{
      stock_name: string;
      stock_code: string;
      reason: string;
    }>;
  };
};

export type ResponsesPipelineResult = {
  statusCode: StatusCode;
  reasons: string[];
  suggestions: string[];
  overallNote: string;
  missingEvidence: string[];
  candidates: AnalyzeSuccessResponse["candidates"];
  searchRoundsUsed: number;
  highestSourceLevelUsedForCoreConclusion: SourceLevel | null;
  roundTrace: {
    rounds: RoundTraceEntry[];
  };
};
