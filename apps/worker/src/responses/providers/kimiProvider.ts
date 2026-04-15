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

const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_MODEL = "kimi-k2.5";
const OFFICIAL_TOOLS_URL = "https://api.moonshot.cn/v1/formulas/moonshot/web-search:latest/tools";
const OFFICIAL_FIBERS_URL = "https://api.moonshot.cn/v1/formulas/moonshot/web-search:latest/fibers";
const TOOLS_TIMEOUT_MS = 15_000;
const COMPLETION_TIMEOUT_MS = 90_000;
const FIBER_TIMEOUT_MS = 45_000;
const REPAIR_TIMEOUT_MS = 15_000;
const TOOL_LOOP_TOTAL_TIMEOUT_MS = 180_000;
const RESEARCH_INSTRUCTIONS =
  "你是阿财项目的后端研究助手。必须使用结构化 JSON 输出，必须优先使用官方搜索工具检索公开网页来源，不得编造来源、股票代码或证据。若搜索结果来自非允许域名，只能作为弱参考，不能用于核心结论。";

type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

type KimiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: KimiToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
};

type KimiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type KimiToolDefinition = {
  type: string;
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type KimiFiberInvocationPayload = {
  encrypted_output: string;
};

class KimiProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "KimiProviderError";
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

function resolveBaseUrl(env: WorkerEnv): string {
  return (env.KIMI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function buildDomainInstructions(allowedSourceLevels: SourceLevel[]): string {
  const allowedDomains = getAllowedDomainsForLevels(allowedSourceLevels);

  return [
    `当前轮次允许的来源等级: ${allowedSourceLevels.join(", ")}`,
    `优先检索的域名白名单: ${allowedDomains.join(", ")}`,
    "如需联网搜索，请优先使用官方搜索工具并尽量带上 site: 限定到白名单域名。",
    "若搜索结果来自白名单外域名，只能作为背景参考，不得作为核心结论依据。",
  ].join("\n");
}

function buildSystemMessage(allowedSourceLevels: SourceLevel[]): string {
  return [RESEARCH_INSTRUCTIONS, buildDomainInstructions(allowedSourceLevels)].join("\n\n");
}

function buildSchemaConstrainedPrompt(prompt: string, schema: JsonSchema): string {
  const requiredFields = Array.isArray(schema.schema.required)
    ? schema.schema.required.join(", ")
    : "请严格遵守 schema";

  return [
    prompt,
    "",
    "输出要求：",
    "1. 只输出一个 JSON 对象，不要输出 Markdown。",
    `2. JSON 必须严格符合 schema 名称 ${schema.name} 对应的结构。`,
    "3. 所有 required 字段都必须填写，不得省略。",
    "4. 数组字段必须输出数组，不能输出字符串或对象替代。",
    "5. round 必须是当前轮次整数；stage 必须是对应阶段常量；allowed_source_levels 必须是字符串数组。",
    `6. 顶层 required 字段: ${requiredFields}`,
    "7. 在给出最终 JSON 前，必须至少调用一次 web_search 工具；没有调用 web_search 之前不得直接回答。",
  ].join("\n");
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; payload: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = (await response.json()) as T;
    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new KimiProviderError(`kimi_request_timeout:${timeoutMs}:${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function logKimiStage(stageLabel: string, message: string, extra?: Record<string, unknown>) {
  console.info("kimi_provider", {
    stage: stageLabel,
    message,
    ...(extra ?? {}),
  });
}

async function fetchOfficialTools(
  env: WorkerEnv,
  stageLabel: string,
): Promise<KimiToolDefinition[]> {
  logKimiStage(stageLabel, "fetch_tools_start");
  const { response, payload } = await fetchJson<{
    data?: KimiToolDefinition[];
    tools?: KimiToolDefinition[];
  }>(
    OFFICIAL_TOOLS_URL,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${env.KIMI_API_KEY}`,
      },
    },
    TOOLS_TIMEOUT_MS,
  );

  const tools = Array.isArray(payload.tools)
    ? payload.tools
    : Array.isArray(payload.data)
      ? payload.data
      : null;

  if (!response.ok || !Array.isArray(tools) || tools.length === 0) {
    throw new KimiProviderError(
      `kimi_fetch_tools_failed:${response.status}:${JSON.stringify(payload)}`,
      response.status,
    );
  }

  logKimiStage(stageLabel, "fetch_tools_success", {
    tool_count: tools.length,
  });
  return tools;
}

async function invokeOfficialFiber(
  env: WorkerEnv,
  input: KimiFiberInvocationPayload,
  stageLabel: string,
  toolName: string,
): Promise<Record<string, unknown>> {
  logKimiStage(stageLabel, "fiber_call_start", {
    tool_name: toolName,
  });
  const { response, payload } = await fetchJson<Record<string, unknown>>(
    OFFICIAL_FIBERS_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.KIMI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    },
    FIBER_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new KimiProviderError(
      `kimi_invoke_fiber_failed:${response.status}:${JSON.stringify(payload)}`,
      response.status,
    );
  }

  logKimiStage(stageLabel, "fiber_call_success", {
    tool_name: toolName,
  });
  return payload;
}

function extractAssistantMessage(payload: Record<string, unknown>): KimiMessage {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new KimiProviderError("kimi_missing_choices");
  }

  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    throw new KimiProviderError("kimi_missing_message");
  }

  const typed = message as Record<string, unknown>;
  return {
    role: "assistant",
    content: typeof typed.content === "string" ? typed.content : "",
    tool_calls: Array.isArray(typed.tool_calls)
      ? (typed.tool_calls as KimiToolCall[])
      : undefined,
    reasoning_content:
      typeof typed.reasoning_content === "string" ? typed.reasoning_content : undefined,
  };
}

function extractJsonText(message: KimiMessage): string {
  const content = message.content?.trim();
  if (!content) {
    throw new KimiProviderError("kimi_missing_content");
  }

  return content;
}

async function runKimiToolLoop(
  env: WorkerEnv,
  prompt: string,
  allowedSourceLevels: SourceLevel[],
  stageLabel: string,
): Promise<string> {
  const startedAt = Date.now();
  const tools = await fetchOfficialTools(env, stageLabel);
  let hasUsedTool = false;
  const messages: KimiMessage[] = [
    {
      role: "system",
      content: buildSystemMessage(allowedSourceLevels),
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  for (let step = 0; step < 6; step += 1) {
    if (Date.now() - startedAt > TOOL_LOOP_TOTAL_TIMEOUT_MS) {
      throw new KimiProviderError(
        `kimi_tool_loop_timeout:${stageLabel}:${Date.now() - startedAt}`,
      );
    }

    logKimiStage(stageLabel, "completion_start", {
      step,
      message_count: messages.length,
    });
    const { response, payload } = await fetchJson<Record<string, unknown>>(
      `${resolveBaseUrl(env)}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.KIMI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: env.KIMI_MODEL ?? DEFAULT_MODEL,
          messages,
          thinking: {
            type: "enabled",
          },
          tools,
          tool_choice: "auto",
          response_format: {
            type: "json_object",
          },
        }),
      },
      COMPLETION_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new KimiProviderError(
        `kimi_chat_completion_failed:${response.status}:${JSON.stringify(payload)}`,
        response.status,
      );
    }

    const assistantMessage = extractAssistantMessage(payload);
    logKimiStage(stageLabel, "completion_success", {
      step,
      has_tool_calls: (assistantMessage.tool_calls?.length ?? 0) > 0,
      tool_call_count: assistantMessage.tool_calls?.length ?? 0,
      has_reasoning: Boolean(assistantMessage.reasoning_content),
      content_length: assistantMessage.content.length,
    });
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (!hasUsedTool) {
        logKimiStage(stageLabel, "completion_missing_required_tool", {
          step,
        });
        messages.push({
          role: "user",
          content:
            "你尚未调用 web_search。请先调用 web_search 至少一次，基于搜索结果再输出最终 JSON。",
        });
        continue;
      }
      logKimiStage(stageLabel, "completion_final_content", {
        step,
      });
      return extractJsonText(assistantMessage);
    }

    hasUsedTool = true;
    for (const toolCall of toolCalls) {
      const encryptedOutput = safeParseEncryptedOutput(toolCall.function.arguments);
      const toolPayload = await invokeOfficialFiber(env, {
        encrypted_output: encryptedOutput,
      }, stageLabel, toolCall.function.name);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify(toolPayload),
      });
    }
  }

  throw new KimiProviderError("kimi_tool_loop_exhausted");
}

async function repairStructuredOutput<T>(
  env: WorkerEnv,
  schema: JsonSchema,
  validator: z.ZodSchema<T>,
  invalidPayload: unknown,
  validationError: z.ZodError<T>,
  stageLabel: string,
): Promise<T> {
  logKimiStage(stageLabel, "repair_start", {
    issue_count: validationError.issues.length,
  });
  const { response, payload } = await fetchJson<Record<string, unknown>>(
    `${resolveBaseUrl(env)}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.KIMI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.KIMI_MODEL ?? DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "你是结构化 JSON 修复器。只能根据给定 JSON 和错误信息修复结构，不得补造新的外部事实。",
          },
          {
            role: "user",
            content: [
              `请将下面这个 JSON 修复为符合 schema ${schema.name} 的对象。`,
              "",
              "Schema:",
              JSON.stringify(schema.schema, null, 2),
              "",
              "当前 JSON:",
              JSON.stringify(invalidPayload, null, 2),
              "",
              "校验错误:",
              JSON.stringify(validationError.issues, null, 2),
              "",
              "只输出修复后的 JSON 对象。",
            ].join("\n"),
          },
        ],
        thinking: {
          type: "disabled",
        },
        response_format: {
          type: "json_object",
        },
      }),
    },
    REPAIR_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new KimiProviderError(
      `kimi_repair_completion_failed:${response.status}:${JSON.stringify(payload)}`,
      response.status,
    );
  }

  const repairedMessage = extractAssistantMessage(payload);
  logKimiStage(stageLabel, "repair_success", {
    content_length: repairedMessage.content.length,
  });
  let repairedParsed: unknown;
  try {
    repairedParsed = JSON.parse(extractJsonText(repairedMessage));
  } catch (error) {
    throw new KimiProviderError(
      `kimi_repair_invalid_json:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }

  return validator.parse(repairedParsed);
}

function safeParseEncryptedOutput(argumentsText: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsText);
  } catch (error) {
    throw new KimiProviderError(
      `kimi_invalid_tool_arguments:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { encrypted_output?: unknown }).encrypted_output !== "string"
  ) {
    throw new KimiProviderError("kimi_missing_encrypted_output");
  }

  return (parsed as { encrypted_output: string }).encrypted_output;
}

async function parseStructuredResponse<T>(
  env: WorkerEnv,
  prompt: string,
  schema: JsonSchema,
  validator: z.ZodSchema<T>,
  allowedSourceLevels: SourceLevel[],
  stageLabel: string,
): Promise<T> {
  const outputText = await runKimiToolLoop(
    env,
    buildSchemaConstrainedPrompt(prompt, schema),
    allowedSourceLevels,
    stageLabel,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new KimiProviderError(
      `kimi_invalid_json:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }

  const validated = validator.safeParse(parsed);
  if (validated.success) {
    logKimiStage(stageLabel, "schema_validate_success");
    return validated.data;
  }

  logKimiStage(stageLabel, "schema_validate_failed", {
    issue_count: validated.error.issues.length,
  });
  return repairStructuredOutput(
    env,
    schema,
    validator,
    parsed,
    validated.error,
    stageLabel,
  );
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

export function createKimiResponsesProvider(env: WorkerEnv): ResponsesProvider {
  return {
    async runCandidateNarrowing({
      request,
      round,
      allowedSourceLevels,
    }): Promise<CandidateNarrowingOutput> {
      const stageLabel = `candidate_narrowing:r${round}`;
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
        stageLabel,
      );
    },

    async runEvidenceVerification({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
    }): Promise<EvidenceVerificationOutput> {
      const stageLabel = `evidence_verification:r${round}`;
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
        stageLabel,
      );
    },

    async runStructuredAssessment({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
      evidenceVerification,
    }): Promise<StructuredAssessmentOutput> {
      const stageLabel = `structured_assessment:r${round}`;
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
        stageLabel,
      );
    },
  };
}
