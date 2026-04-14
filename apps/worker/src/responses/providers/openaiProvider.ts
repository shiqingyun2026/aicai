import {
  confidenceLevelValues,
  sourceLevelValues,
  statusCodeValues,
  type AnalyzeRequest,
  type SourceLevel,
} from "@acai/shared";
import { z } from "zod";
import type { WorkerEnv } from "../../storage/types";
import { getAllowedDomainsForLevels } from "../sourcePolicy";
import {
  buildCandidateNarrowingPrompt,
  buildEvidenceVerificationPrompt,
  buildStructuredAssessmentPrompt,
} from "../prompts";
import {
  CandidateNarrowingSchema,
  EvidenceVerificationSchema,
  StructuredAssessmentSchema,
  type CandidateNarrowingOutput,
  type EvidenceVerificationOutput,
  type ResponsesProvider,
  type StructuredAssessmentOutput,
} from "../types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5";

type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

class OpenAIResponsesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenAIResponsesError";
  }
}

const candidateNarrowingJsonSchema: JsonSchema = {
  name: "acai_candidate_narrowing_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["round", "stage", "allowed_source_levels", "candidate_pool", "excluded_candidates", "search_notes"],
    properties: {
      round: { type: "integer", minimum: 1, maximum: 4 },
      stage: { type: "string", const: "candidate_narrowing" },
      allowed_source_levels: {
        type: "array",
        items: { type: "string", enum: [...sourceLevelValues] },
      },
      candidate_pool: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["stock_name", "stock_code", "industry", "selection_thesis", "preliminary_match_points"],
          properties: {
            stock_name: { type: "string" },
            stock_code: { type: "string" },
            industry: { type: "string" },
            selection_thesis: { type: "string" },
            preliminary_match_points: {
              type: "array",
              items: { type: "string" },
              maxItems: 5,
            },
          },
        },
      },
      excluded_candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "reason"],
          properties: {
            name: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      search_notes: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
    },
  },
};

const evidenceVerificationJsonSchema: JsonSchema = {
  name: "acai_evidence_verification_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "round",
      "stage",
      "allowed_source_levels",
      "candidate_evaluations",
      "evidence_sufficient",
      "missing_evidence",
      "should_escalate_to_next_round",
    ],
    properties: {
      round: { type: "integer", minimum: 1, maximum: 4 },
      stage: { type: "string", const: "evidence_verification" },
      allowed_source_levels: {
        type: "array",
        items: { type: "string", enum: [...sourceLevelValues] },
      },
      candidate_evaluations: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "stock_name",
            "stock_code",
            "is_qualified_in_current_round",
            "source_level_coverage",
            "evidence_items",
            "missing_evidence",
            "disqualify_reasons",
          ],
          properties: {
            stock_name: { type: "string" },
            stock_code: { type: "string" },
            is_qualified_in_current_round: { type: "boolean" },
            source_level_coverage: {
              type: "array",
              items: { type: "string", enum: [...sourceLevelValues] },
            },
            evidence_items: {
              type: "array",
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "source_level",
                  "source_name",
                  "source_domain",
                  "title",
                  "url",
                  "publish_date",
                  "snippet",
                  "supports_core_conclusion",
                ],
                properties: {
                  source_level: { type: "string", enum: [...sourceLevelValues] },
                  source_name: { type: "string" },
                  source_domain: { type: "string" },
                  title: { type: "string" },
                  url: { type: "string", format: "uri" },
                  publish_date: { type: "string" },
                  snippet: { type: "string" },
                  supports_core_conclusion: { type: "boolean" },
                },
              },
            },
            missing_evidence: {
              type: "array",
              items: { type: "string" },
            },
            disqualify_reasons: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
      evidence_sufficient: { type: "boolean" },
      missing_evidence: {
        type: "array",
        items: { type: "string" },
      },
      should_escalate_to_next_round: { type: "boolean" },
    },
  },
};

const structuredAssessmentJsonSchema: JsonSchema = {
  name: "acai_structured_assessment_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "round",
      "stage",
      "allowed_source_levels",
      "proposed_status",
      "qualified_candidates",
      "rejected_candidates",
      "reasons",
      "suggestions",
      "overall_note",
      "evidence_sufficient",
      "missing_evidence",
      "should_escalate_to_next_round",
    ],
    properties: {
      round: { type: "integer", minimum: 1, maximum: 4 },
      stage: { type: "string", const: "structured_assessment" },
      allowed_source_levels: {
        type: "array",
        items: { type: "string", enum: [...sourceLevelValues] },
      },
      proposed_status: {
        type: "string",
        enum: [...statusCodeValues],
      },
      qualified_candidates: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "stock_name",
            "stock_code",
            "industry",
            "selection_reason",
            "evidence_summary",
            "major_risks",
            "uncertainties",
            "confidence_level",
            "confidence_score",
          ],
          properties: {
            stock_name: { type: "string" },
            stock_code: { type: "string" },
            industry: { type: "string" },
            selection_reason: { type: "string" },
            evidence_summary: { type: "string" },
            major_risks: { type: "string" },
            uncertainties: { type: "string" },
            confidence_level: { type: "string", enum: [...confidenceLevelValues] },
            confidence_score: { type: "integer", minimum: 0, maximum: 100 },
          },
        },
      },
      rejected_candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["stock_name", "stock_code", "reason"],
          properties: {
            stock_name: { type: "string" },
            stock_code: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      reasons: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      suggestions: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      overall_note: { type: "string" },
      evidence_sufficient: { type: "boolean" },
      missing_evidence: {
        type: "array",
        items: { type: "string" },
      },
      should_escalate_to_next_round: { type: "boolean" },
    },
  },
};

function buildRequestBody(
  env: WorkerEnv,
  prompt: string,
  schema: JsonSchema,
  allowedSourceLevels: SourceLevel[],
): RequestInit {
  const allowedDomains = getAllowedDomainsForLevels(allowedSourceLevels);

  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_RESPONSES_MODEL ?? DEFAULT_MODEL,
      instructions:
        "你是阿财项目的后端研究助手。必须使用结构化 JSON 输出，必须只基于公开来源与搜索结果，不得编造来源、股票代码或证据。",
      input: prompt,
      reasoning: {
        effort: "low",
      },
      tools: [
        {
          type: "web_search",
          filters: {
            allowed_domains: allowedDomains,
          },
          search_context_size: allowedSourceLevels.includes("L4") ? "high" : "medium",
        },
      ],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      text: {
        format: {
          type: "json_schema",
          name: schema.name,
          strict: true,
          schema: schema.schema,
        },
      },
    }),
  };
}

async function parseStructuredResponse<T>(
  env: WorkerEnv,
  prompt: string,
  schema: JsonSchema,
  validator: z.ZodSchema<T>,
  allowedSourceLevels: SourceLevel[],
): Promise<T> {
  const response = await fetch(
    OPENAI_RESPONSES_URL,
    buildRequestBody(env, prompt, schema, allowedSourceLevels),
  );

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new OpenAIResponsesError(
      `responses_api_request_failed:${response.status}:${JSON.stringify(payload)}`,
      response.status,
    );
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new OpenAIResponsesError("responses_api_missing_output_text");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new OpenAIResponsesError(
      `responses_api_invalid_json:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }

  return validator.parse(parsed);
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  const output = payload.output;
  if (!Array.isArray(output)) {
    return null;
  }

  const fragments: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }

      const typed = contentItem as { type?: unknown; text?: unknown };
      if ((typed.type === "output_text" || typed.type === "text") && typeof typed.text === "string") {
        fragments.push(typed.text);
      }
    }
  }

  return fragments.length > 0 ? fragments.join("\n").trim() : null;
}

function candidateSnapshot(candidateNarrowing: CandidateNarrowingOutput): string {
  return JSON.stringify(candidateNarrowing.candidate_pool, null, 2);
}

function evidenceSnapshot(evidenceVerification: EvidenceVerificationOutput): string {
  return JSON.stringify(
    evidenceVerification.candidate_evaluations.map((item) => ({
      stock_name: item.stock_name,
      stock_code: item.stock_code,
      is_qualified_in_current_round: item.is_qualified_in_current_round,
      source_level_coverage: item.source_level_coverage,
      missing_evidence: item.missing_evidence,
      disqualify_reasons: item.disqualify_reasons,
    })),
    null,
    2,
  );
}

export function createOpenAIResponsesProvider(env: WorkerEnv): ResponsesProvider {
  return {
    async runCandidateNarrowing({
      request,
      round,
      allowedSourceLevels,
    }): Promise<CandidateNarrowingOutput> {
      return parseStructuredResponse(
        env,
        buildCandidateNarrowingPrompt(
          request,
          round,
          allowedSourceLevels,
          getAllowedDomainsForLevels(allowedSourceLevels),
        ),
        candidateNarrowingJsonSchema,
        CandidateNarrowingSchema,
        allowedSourceLevels,
      );
    },

    async runEvidenceVerification({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
    }): Promise<EvidenceVerificationOutput> {
      return parseStructuredResponse(
        env,
        buildEvidenceVerificationPrompt(
          request,
          round,
          allowedSourceLevels,
          getAllowedDomainsForLevels(allowedSourceLevels),
          candidateSnapshot(candidateNarrowing),
        ),
        evidenceVerificationJsonSchema,
        EvidenceVerificationSchema,
        allowedSourceLevels,
      );
    },

    async runStructuredAssessment({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
      evidenceVerification,
    }): Promise<StructuredAssessmentOutput> {
      return parseStructuredResponse(
        env,
        buildStructuredAssessmentPrompt(
          request,
          round,
          allowedSourceLevels,
          getAllowedDomainsForLevels(allowedSourceLevels),
          candidateSnapshot(candidateNarrowing),
          evidenceSnapshot(evidenceVerification),
        ),
        structuredAssessmentJsonSchema,
        StructuredAssessmentSchema,
        allowedSourceLevels,
      );
    },
  };
}
