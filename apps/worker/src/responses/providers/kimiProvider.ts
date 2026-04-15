import {
  confidenceLevelValues,
  sourceLevelValues,
  statusCodeValues,
  type AnalyzeRequest,
  type SourceLevel,
} from "@acai/shared";
import { z } from "zod";
import type { WorkerEnv } from "../../storage/types";
import { getAllowedDomainsForLevels, inferSourceLevelForDomain } from "../sourcePolicy";
import {
  buildSearchContextBlock,
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
  type ProviderStageResult,
  type ResponsesProvider,
  type ResponseStageTrace,
  type SearchContextItem,
  type StructuredAssessmentOutput,
} from "../types";

const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_MODEL = "kimi-k2.5";
const DEFAULT_WEB_SEARCH_FORMULA = "moonshot/web-search:latest";
const WEB_SEARCH_TOOL_NAME = "web_search";
const TOOLS_TIMEOUT_MS = 15_000;
const COMPLETION_TIMEOUT_MS = 90_000;
const FIBER_TIMEOUT_MS = 45_000;
const REPAIR_TIMEOUT_MS = 15_000;
const STAGE_TOTAL_TIMEOUT_MS = 180_000;
const MAX_SEARCH_CONTEXT_ITEMS = 12;
const MAX_SEARCH_QUERIES_PER_STAGE = 4;
const RESEARCH_INSTRUCTIONS =
  "你是阿财项目的后端研究助手。Worker 已经通过 Kimi Formula web-search 显式检索公开网页来源，你必须基于 search_context 和工具返回内容推理，并输出结构化 JSON。不得编造来源、股票代码或证据。若搜索结果来自非允许域名，只能作为弱参考，不能用于核心结论。";

type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

type KimiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_content?: string;
};

type KimiFiberInvocationPayload = {
  name: string;
  arguments: string;
};

type KimiSearchBatch = {
  queries: string[];
  searchContextItems: SearchContextItem[];
  toolMessages: KimiMessage[];
  encryptedOutputCount: number;
  failures: string[];
  reusedPriorEvidence?: boolean;
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

function resolveWebSearchFormula(env: WorkerEnv): string {
  return (env.KIMI_WEB_SEARCH_FORMULA ?? DEFAULT_WEB_SEARCH_FORMULA).trim();
}

function buildFormulaToolsUrl(env: WorkerEnv): string {
  return `${resolveBaseUrl(env)}/formulas/${resolveWebSearchFormula(env)}/tools`;
}

function buildFormulaFibersUrl(env: WorkerEnv): string {
  return `${resolveBaseUrl(env)}/formulas/${resolveWebSearchFormula(env)}/fibers`;
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
    "7. 只能基于给定的 search_context、候选摘要、证据摘要和常识性推理作答，不得编造未提供的来源。",
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
): Promise<{
  type: string;
  function?: {
    name: string;
  };
}[]> {
  logKimiStage(stageLabel, "fetch_tools_start");
  const { response, payload } = await fetchJson<{
    data?: Array<{ type: string; function?: { name: string } }>;
    tools?: Array<{ type: string; function?: { name: string } }>;
  }>(
    buildFormulaToolsUrl(env),
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
  logKimiStage(stageLabel, "search_start", {
    tool_name: toolName,
  });
  const { response, payload } = await fetchJson<Record<string, unknown>>(
    buildFormulaFibersUrl(env),
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
    logKimiStage(stageLabel, "search_failure", {
      tool_name: toolName,
      status: response.status,
    });
    throw new KimiProviderError(
      `kimi_invoke_fiber_failed:${response.status}:${JSON.stringify(payload)}`,
      response.status,
    );
  }

  logKimiStage(stageLabel, "search_success", {
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

function extractString(
  source: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function extractSearchContextItemsFromUnknown(
  query: string,
  value: unknown,
): SearchContextItem[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractSearchContextItemsFromUnknown(query, item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const nestedItems = [
    ...extractSearchContextItemsFromUnknown(query, record.results),
    ...extractSearchContextItemsFromUnknown(query, record.items),
    ...extractSearchContextItemsFromUnknown(query, record.sources),
    ...extractSearchContextItemsFromUnknown(query, record.output),
    ...extractSearchContextItemsFromUnknown(query, record.data),
    ...extractSearchContextItemsFromUnknown(query, record.context),
  ];

  const url = extractString(record, ["url", "link", "source_url"]);
  const title = extractString(record, ["title", "name", "headline"]);
  const sourceDomain = extractString(record, ["source_domain", "domain", "site", "hostname"]);
  const sourceName = extractString(record, ["source_name", "site_name", "publisher", "source"]);
  const snippet = extractString(record, ["snippet", "summary", "content", "text", "description"]);
  const publishDate = extractString(record, ["publish_date", "published_at", "date", "time"]);

  const maybeItem =
    url || title || sourceDomain || sourceName || snippet
      ? [
          {
            query,
            source_level: inferSourceLevelForDomain(sourceDomain || url),
            source_name: sourceName,
            source_domain: sourceDomain,
            title,
            url,
            publish_date: publishDate,
            snippet,
          } satisfies SearchContextItem,
        ]
      : [];

  return [...maybeItem, ...nestedItems];
}

function dedupeSearchContextItems(items: SearchContextItem[]): SearchContextItem[] {
  const byKey = new Map<string, SearchContextItem>();

  for (const item of items) {
    const key = `${item.query}::${item.url || item.title || item.source_domain || item.snippet}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].slice(0, MAX_SEARCH_CONTEXT_ITEMS);
}

function collectEncryptedOutputCount(payload: unknown): number {
  if (Array.isArray(payload)) {
    return payload.reduce((count, item) => count + collectEncryptedOutputCount(item), 0);
  }

  if (!payload || typeof payload !== "object") {
    return 0;
  }

  const record = payload as Record<string, unknown>;
  return Object.entries(record).reduce((count, [key, value]) => {
    const extra = key === "encrypted_output" && typeof value === "string" ? 1 : 0;
    return count + extra + collectEncryptedOutputCount(value);
  }, 0);
}

function compactText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}…`;
}

function buildSiteQuery(seed: string, domains: string[]): string {
  if (domains.length === 0) {
    return seed;
  }

  return `${seed} (${domains.map((domain) => `site:${domain}`).join(" OR ")})`;
}

function buildCandidateNarrowingQueries(
  request: AnalyzeRequest,
  round: number,
  allowedDomains: string[],
): string[] {
  const industryTerms = request.industry_preference.slice(0, 3);
  const styleLabel = request.style_preference;
  const cycleLabel = request.investment_cycle;
  const baseSeeds = [
    `中国A股 ${industryTerms.join(" ")} ${styleLabel} ${cycleLabel} 候选 公司 公告 年报`,
    `中国A股 ${industryTerms.join(" ")} 分红 现金流 龙头 公司 ${cycleLabel}`,
  ];

  if (round >= 2) {
    baseSeeds.push(`中国A股 ${industryTerms.join(" ")} 经营 韧性 公告 采访`);
  }

  if (round >= 3) {
    baseSeeds.push(`中国A股 ${industryTerms.join(" ")} 景气度 行业 研判`);
  }

  if (round >= 4) {
    baseSeeds.push(`中国A股 ${industryTerms.join(" ")} 投资者 讨论 风险 争议`);
  }

  return baseSeeds
    .map((seed) => compactText(buildSiteQuery(seed.trim(), allowedDomains)))
    .filter(Boolean)
    .slice(0, MAX_SEARCH_QUERIES_PER_STAGE);
}

function buildEvidenceVerificationQueries(
  candidateNarrowing: CandidateNarrowingOutput,
  round: number,
  allowedDomains: string[],
): string[] {
  const prioritizedCandidates = candidateNarrowing.candidate_pool.slice(0, 2);
  const queries = prioritizedCandidates.flatMap((candidate) => {
    const seeds = [`${candidate.stock_name} ${candidate.stock_code} 年报 公告 分红 现金流`];

    if (round >= 2) {
      seeds.push(`${candidate.stock_name} ${candidate.stock_code} 主营业务 业绩 公告`);
    }
    if (round >= 3) {
      seeds.push(`${candidate.stock_name} ${candidate.stock_code} 行业 景气 研报`);
    }
    if (round >= 4) {
      seeds.push(`${candidate.stock_name} ${candidate.stock_code} 风险 争议`);
    }

    return seeds.map((seed) => compactText(buildSiteQuery(seed, allowedDomains)));
  });

  return Array.from(new Set(queries)).slice(0, MAX_SEARCH_QUERIES_PER_STAGE);
}

function buildStructuredAssessmentQueries(
  evidenceVerification: EvidenceVerificationOutput,
  round: number,
  allowedDomains: string[],
): string[] {
  const stillMissing = evidenceVerification.missing_evidence.slice(0, 3).join(" ");
  if (!stillMissing && evidenceVerification.evidence_sufficient) {
    return [];
  }

  const candidateNames = evidenceVerification.candidate_evaluations
    .slice(0, 3)
    .map((item) => `${item.stock_name} ${item.stock_code}`)
    .join(" ");
  const seeds = [
    `${candidateNames} ${stillMissing || "补充 核心 证据"} 公告 年报`,
  ];

  if (round >= 3) {
    seeds.push(`${candidateNames} ${stillMissing || "经营 风险"} 行业 研报`);
  }

  if (round >= 4) {
    seeds.push(`${candidateNames} ${stillMissing || "市场 争议"} 社区 讨论`);
  }

  return seeds
    .map((seed) => compactText(buildSiteQuery(seed, allowedDomains)))
    .filter(Boolean)
    .slice(0, MAX_SEARCH_QUERIES_PER_STAGE);
}

async function runKimiSearchBatch(
  env: WorkerEnv,
  queries: string[],
  stageLabel: string,
): Promise<KimiSearchBatch> {
  const tools = await fetchOfficialTools(env, stageLabel);
  if (!tools.some((tool) => tool.function?.name === WEB_SEARCH_TOOL_NAME)) {
    throw new KimiProviderError("kimi_web_search_tool_unavailable");
  }

  const normalizedQueries = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)))
    .slice(0, MAX_SEARCH_QUERIES_PER_STAGE);
  const toolMessages: KimiMessage[] = [];
  const searchContextItems: SearchContextItem[] = [];
  const failures: string[] = [];
  let encryptedOutputCount = 0;

  for (const query of normalizedQueries) {
    try {
      const toolPayload = await invokeOfficialFiber(
        env,
        {
          name: WEB_SEARCH_TOOL_NAME,
          arguments: JSON.stringify({ query }),
        },
        stageLabel,
        WEB_SEARCH_TOOL_NAME,
      );
      encryptedOutputCount += collectEncryptedOutputCount(toolPayload);
      searchContextItems.push(...extractSearchContextItemsFromUnknown(query, toolPayload));
      if (toolMessages.length < 2) {
        toolMessages.push({
          role: "assistant",
          content: [
            `web_search query: ${query}`,
            JSON.stringify(toolPayload).slice(0, 4000),
          ].join("\n"),
        });
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "unknown_kimi_search_error";
      failures.push(`${query}: ${reason}`);
    }
  }

  return {
    queries: normalizedQueries,
    searchContextItems: dedupeSearchContextItems(searchContextItems),
    toolMessages,
    encryptedOutputCount,
    failures,
  };
}

async function runKimiCompletion(
  env: WorkerEnv,
  prompt: string,
  allowedSourceLevels: SourceLevel[],
  stageLabel: string,
  supportingMessages: KimiMessage[],
): Promise<string> {
  logKimiStage(stageLabel, "completion_start", {
    message_count: supportingMessages.length + 2,
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
            content: buildSystemMessage(allowedSourceLevels),
          },
          ...supportingMessages,
          {
            role: "user",
            content: prompt,
          },
        ],
        thinking: {
          type: "enabled",
        },
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
    has_reasoning: Boolean(assistantMessage.reasoning_content),
    content_length: assistantMessage.content.length,
  });
  return extractJsonText(assistantMessage);
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

async function parseStructuredResponse<T>(
  env: WorkerEnv,
  prompt: string,
  schema: JsonSchema,
  validator: z.ZodSchema<T>,
  allowedSourceLevels: SourceLevel[],
  stageLabel: string,
  searchBatch: KimiSearchBatch,
): Promise<ProviderStageResult<T>> {
  const startedAt = Date.now();
  const searchContextBlock = buildSearchContextBlock(searchBatch.searchContextItems);
  const outputText = await runKimiCompletion(
    env,
    buildSchemaConstrainedPrompt(
      [
        prompt,
        "",
        searchContextBlock,
      ].join("\n\n"),
      schema,
    ),
    allowedSourceLevels,
    stageLabel,
    searchBatch.toolMessages,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new KimiProviderError(
      `kimi_invalid_json:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }
  parsed = normalizeStagePayload(stageLabel, parsed);

  const validated = validator.safeParse(parsed);
  if (validated.success) {
    logKimiStage(stageLabel, "schema_validate_success");
    return {
      output: validated.data,
      trace: {
        provider: "kimi",
        completion_model: env.KIMI_MODEL ?? DEFAULT_MODEL,
        search_queries: searchBatch.queries,
        search_context_items: searchBatch.searchContextItems,
        encrypted_output_count: searchBatch.encryptedOutputCount,
        search_failures: searchBatch.failures.length > 0 ? searchBatch.failures : undefined,
        reused_prior_evidence: searchBatch.reusedPriorEvidence,
      },
    };
  }

  const normalizedAgain = normalizeStagePayload(stageLabel, parsed);
  const normalizedAgainValidated = validator.safeParse(normalizedAgain);
  if (normalizedAgainValidated.success) {
    logKimiStage(stageLabel, "schema_validate_success_after_normalize");
    return {
      output: normalizedAgainValidated.data,
      trace: {
        provider: "kimi",
        completion_model: env.KIMI_MODEL ?? DEFAULT_MODEL,
        search_queries: searchBatch.queries,
        search_context_items: searchBatch.searchContextItems,
        encrypted_output_count: searchBatch.encryptedOutputCount,
        search_failures: searchBatch.failures.length > 0 ? searchBatch.failures : undefined,
        reused_prior_evidence: searchBatch.reusedPriorEvidence,
      },
    };
  }

  logKimiStage(stageLabel, "schema_validate_failed", {
    issue_count: normalizedAgainValidated.error.issues.length,
    issues_preview: normalizedAgainValidated.error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
    parsed_preview:
      typeof normalizedAgain === "object" && normalizedAgain !== null
        ? JSON.stringify(normalizedAgain).slice(0, 4000)
        : String(normalizedAgain).slice(0, 4000),
  });
  const repaired = await repairStructuredOutput(
    env,
    schema,
    validator,
    normalizedAgain,
    normalizedAgainValidated.error,
    stageLabel,
  );

  if (Date.now() - startedAt > STAGE_TOTAL_TIMEOUT_MS) {
    throw new KimiProviderError(
      `kimi_stage_timeout:${stageLabel}:${Date.now() - startedAt}`,
    );
  }

  return {
    output: repaired,
    trace: {
      provider: "kimi",
      completion_model: env.KIMI_MODEL ?? DEFAULT_MODEL,
      search_queries: searchBatch.queries,
      search_context_items: searchBatch.searchContextItems,
      encrypted_output_count: searchBatch.encryptedOutputCount,
      search_failures: searchBatch.failures.length > 0 ? searchBatch.failures : undefined,
      reused_prior_evidence: searchBatch.reusedPriorEvidence,
    },
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function pickStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
  }

  return [];
}

function normalizeStageValue(value: unknown, expectedStage: string): string {
  if (typeof value !== "string") {
    return expectedStage;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "narrowing") {
    return "candidate_narrowing";
  }
  if (normalized === "evidence" || normalized === "verification") {
    return "evidence_verification";
  }
  if (
    normalized === "assessment" ||
    normalized === "structured" ||
    normalized === "initial_assessment" ||
    normalized === "final_assessment"
  ) {
    return "structured_assessment";
  }

  return normalized || expectedStage;
}

function normalizeStockCodeValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : value.trim();
}

function normalizeCandidateNarrowingPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }

  return {
    ...record,
    stage: normalizeStageValue(record.stage, "candidate_narrowing"),
    candidate_pool: Array.isArray(record.candidate_pool)
      ? record.candidate_pool.slice(0, 12).map((item) => {
          const candidate = asRecord(item);
          if (!candidate) {
            return item;
          }

          return {
            stock_name: pickFirstString(candidate, ["stock_name", "name"]),
            stock_code: normalizeStockCodeValue(candidate.stock_code ?? candidate.code),
            industry: pickFirstString(candidate, ["industry", "sector"]),
            selection_thesis: pickFirstString(candidate, ["selection_thesis", "reason", "selection_reason"]),
            preliminary_match_points:
              pickStringArray(candidate, ["preliminary_match_points", "match_points"]).slice(0, 5),
          };
        })
      : [],
    excluded_candidates: Array.isArray(record.excluded_candidates)
      ? record.excluded_candidates.map((item) => {
          const candidate = asRecord(item);
          if (!candidate) {
            return item;
          }

          return {
            name: pickFirstString(candidate, ["name", "stock_name"]),
            reason: pickFirstString(candidate, ["reason"]),
          };
        })
      : [],
    search_notes: pickStringArray(record, ["search_notes", "notes"]).slice(0, 5),
  };
}

function normalizeEvidenceVerificationPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }

  return {
    ...record,
    stage: normalizeStageValue(record.stage, "evidence_verification"),
    candidate_evaluations: Array.isArray(record.candidate_evaluations)
      ? record.candidate_evaluations.map((item) => {
          const evaluation = asRecord(item);
          if (!evaluation) {
            return item;
          }

          return {
            stock_name: pickFirstString(evaluation, ["stock_name", "name"]),
            stock_code: normalizeStockCodeValue(evaluation.stock_code ?? evaluation.code),
            is_qualified_in_current_round:
              typeof evaluation.is_qualified_in_current_round === "boolean"
                ? evaluation.is_qualified_in_current_round
                : Boolean(evaluation.is_qualified ?? evaluation.qualified),
            source_level_coverage: pickStringArray(evaluation, ["source_level_coverage", "covered_levels"]).map((item) =>
              item.toUpperCase(),
            ),
            evidence_items: Array.isArray(evaluation.evidence_items)
              ? evaluation.evidence_items.map((evidence) => {
                  const entry = asRecord(evidence);
                  if (!entry) {
                    return evidence;
                  }

                  return {
                    source_level: pickFirstString(entry, ["source_level", "level"]).toUpperCase() || "L3",
                    source_name: pickFirstString(entry, ["source_name", "site_name", "source"]),
                    source_domain: pickFirstString(entry, ["source_domain", "domain", "site"]),
                    title: pickFirstString(entry, ["title", "headline"]),
                    url: pickFirstString(entry, ["url", "link"]),
                    publish_date: pickFirstString(entry, ["publish_date", "date", "published_at"]),
                    snippet: pickFirstString(entry, ["snippet", "summary", "content"]),
                    supports_core_conclusion:
                      typeof entry.supports_core_conclusion === "boolean"
                        ? entry.supports_core_conclusion
                        : Boolean(entry.is_core || entry.core),
                  };
                })
              : [],
            missing_evidence: pickStringArray(evaluation, ["missing_evidence"]),
            disqualify_reasons: pickStringArray(evaluation, ["disqualify_reasons", "reasons"]),
          };
        })
      : [],
    missing_evidence: pickStringArray(record, ["missing_evidence"]),
  };
}

function normalizeStructuredAssessmentPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }

  let proposedStatus = pickFirstString(record, ["proposed_status", "status"]).toUpperCase();
  if (proposedStatus === "HAS_CANDIDATE") {
    proposedStatus = "HAS_CANDIDATES";
  }
  if (proposedStatus === "NO_CANDIDATE") {
    proposedStatus = "NO_CLEAR_CANDIDATES";
  }

  return {
    ...record,
    stage: normalizeStageValue(record.stage, "structured_assessment"),
    proposed_status: proposedStatus || "NO_CLEAR_CANDIDATES",
    qualified_candidates: Array.isArray(record.qualified_candidates)
      ? record.qualified_candidates.map((item) => {
          const candidate = asRecord(item);
          if (!candidate) {
            return item;
          }

          return {
            stock_name: pickFirstString(candidate, ["stock_name", "name"]),
            stock_code: normalizeStockCodeValue(candidate.stock_code ?? candidate.code),
            industry: pickFirstString(candidate, ["industry", "sector"]),
            selection_reason: pickFirstString(candidate, ["selection_reason", "reason"]),
            evidence_summary: pickFirstString(candidate, ["evidence_summary", "summary"]),
            major_risks: pickFirstString(candidate, ["major_risks", "risk"]),
            uncertainties: pickFirstString(candidate, ["uncertainties", "uncertainty"]),
            confidence_level: pickFirstString(candidate, ["confidence_level"]).toUpperCase() || "MEDIUM",
            confidence_score:
              typeof candidate.confidence_score === "number"
                ? candidate.confidence_score
                : typeof candidate.score === "number"
                  ? candidate.score
                  : 60,
          };
        })
      : [],
    rejected_candidates: Array.isArray(record.rejected_candidates)
      ? record.rejected_candidates.map((item) => {
          const candidate = asRecord(item);
          if (!candidate) {
            return item;
          }

          return {
            stock_name: pickFirstString(candidate, ["stock_name", "name"]),
            stock_code: normalizeStockCodeValue(candidate.stock_code ?? candidate.code),
            reason: pickFirstString(candidate, ["reason"]),
          };
        })
      : [],
    reasons: pickStringArray(record, ["reasons"]),
    suggestions: pickStringArray(record, ["suggestions"]),
    missing_evidence: pickStringArray(record, ["missing_evidence"]),
  };
}

function normalizeStagePayload<T>(stageLabel: string, payload: T): T {
  if (stageLabel.startsWith("candidate_narrowing:")) {
    return normalizeCandidateNarrowingPayload(payload) as T;
  }
  if (stageLabel.startsWith("evidence_verification:")) {
    return normalizeEvidenceVerificationPayload(payload) as T;
  }
  if (stageLabel.startsWith("structured_assessment:")) {
    return normalizeStructuredAssessmentPayload(payload) as T;
  }

  return payload;
}

export function createKimiResponsesProvider(env: WorkerEnv): ResponsesProvider {
  return {
    async runCandidateNarrowing({
      request,
      round,
      allowedSourceLevels,
    }) {
      const stageLabel = `candidate_narrowing:r${round}`;
      const allowedDomains = getAllowedDomainsForLevels(allowedSourceLevels);
      const searchBatch = await runKimiSearchBatch(
        env,
        buildCandidateNarrowingQueries(request, round, allowedDomains),
        stageLabel,
      );
      return parseStructuredResponse(
        env,
        buildCandidateNarrowingPrompt(
          request,
          round,
          allowedSourceLevels,
          allowedDomains,
        ),
        candidateNarrowingJsonSchema,
        CandidateNarrowingSchema,
        allowedSourceLevels,
        stageLabel,
        searchBatch,
      );
    },

    async runEvidenceVerification({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
    }) {
      const stageLabel = `evidence_verification:r${round}`;
      const allowedDomains = getAllowedDomainsForLevels(allowedSourceLevels);
      const searchBatch = await runKimiSearchBatch(
        env,
        buildEvidenceVerificationQueries(candidateNarrowing, round, allowedDomains),
        stageLabel,
      );
      return parseStructuredResponse(
        env,
        buildEvidenceVerificationPrompt(
          request,
          round,
          allowedSourceLevels,
          allowedDomains,
          candidateSnapshot(candidateNarrowing),
        ),
        evidenceVerificationJsonSchema,
        EvidenceVerificationSchema,
        allowedSourceLevels,
        stageLabel,
        searchBatch,
      );
    },

    async runStructuredAssessment({
      request,
      round,
      allowedSourceLevels,
      candidateNarrowing,
      evidenceVerification,
    }) {
      const stageLabel = `structured_assessment:r${round}`;
      const allowedDomains = getAllowedDomainsForLevels(allowedSourceLevels);
      const needsFreshSearch =
        !evidenceVerification.evidence_sufficient || evidenceVerification.missing_evidence.length > 0;
      const searchBatch = needsFreshSearch
        ? await runKimiSearchBatch(
            env,
            buildStructuredAssessmentQueries(evidenceVerification, round, allowedDomains),
            stageLabel,
          )
        : {
            queries: [],
            searchContextItems: dedupeSearchContextItems(
              evidenceVerification.candidate_evaluations.flatMap((evaluation) =>
                evaluation.evidence_items.map((item) => ({
                  query: `${evaluation.stock_name} ${evaluation.stock_code} 已核验证据`,
                  source_level: item.source_level,
                  source_name: item.source_name,
                  source_domain: item.source_domain,
                  title: item.title,
                  url: item.url,
                  publish_date: item.publish_date,
                  snippet: item.snippet,
                })),
              ),
            ),
            toolMessages: [],
            encryptedOutputCount: 0,
            failures: [],
            reusedPriorEvidence: true,
          };
      return parseStructuredResponse(
        env,
        buildStructuredAssessmentPrompt(
          request,
          round,
          allowedSourceLevels,
          allowedDomains,
          candidateSnapshot(candidateNarrowing),
          evidenceSnapshot(evidenceVerification),
        ),
        structuredAssessmentJsonSchema,
        StructuredAssessmentSchema,
        allowedSourceLevels,
        stageLabel,
        searchBatch,
      );
    },
  };
}
