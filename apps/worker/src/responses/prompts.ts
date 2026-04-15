import type { AnalyzeRequest, SourceLevel } from "@acai/shared";
import type { SearchContextItem } from "./types";

function buildRequestSummary(request: AnalyzeRequest): string {
  return [
    `预算: ${request.budget} 元`,
    `目标收益参考: ${request.target_return_reference}%`,
    `风险承受能力: ${request.risk_tolerance}`,
    `投资周期: ${request.investment_cycle}`,
    `接受更高波动: ${request.volatility_acceptance ? "是" : "否"}`,
    `风格偏好: ${request.style_preference}`,
    `行业偏好: ${request.industry_preference.join("、") || "不限"}`,
  ].join("\n");
}

function buildPolicyBlock(allowedSourceLevels: SourceLevel[], allowedDomains: string[]): string {
  return [
    `当前轮次允许的来源等级: ${allowedSourceLevels.join(", ")}`,
    `当前轮次允许的搜索域名: ${allowedDomains.join(", ")}`,
    "必须优先使用 web_search 提供的公开网页来源，不得虚构来源。",
    "四级来源只能补背景，不能支撑核心候选结论。",
    "如果当前轮次证据不足，应明确返回缺失项并决定是否升级到下一轮。",
    "股票代码必须是中国 A 股常见代码格式。",
  ].join("\n");
}

export function buildSearchContextBlock(searchContextItems: SearchContextItem[]): string {
  if (searchContextItems.length === 0) {
    return "search_context: []";
  }

  return [
    "search_context:",
    ...searchContextItems.map((item, index) =>
      [
        `${index + 1}. query: ${item.query}`,
        `source_level: ${item.source_level ?? "UNKNOWN"}`,
        `source_name: ${item.source_name || "未知来源"}`,
        `source_domain: ${item.source_domain || "未知域名"}`,
        `title: ${item.title || "无标题"}`,
        `url: ${item.url || "无链接"}`,
        `publish_date: ${item.publish_date || "未知"}`,
        `snippet: ${item.snippet || "无摘要"}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

export function buildCandidateNarrowingPrompt(
  request: AnalyzeRequest,
  round: number,
  allowedSourceLevels: SourceLevel[],
  allowedDomains: string[],
): string {
  return [
    "你是阿财项目的候选股票初筛分析器。",
    "任务是根据用户条件与当前允许来源范围，收敛一个候选池，并给出初筛说明。",
    buildPolicyBlock(allowedSourceLevels, allowedDomains),
    "请优先寻找披露充分、与条件更匹配、便于后续做证据核验的 A 股候选。",
    `当前轮次: ${round}`,
    "用户条件如下：",
    buildRequestSummary(request),
    "输出要求：候选池最多 12 只；若发现明显不匹配对象，可写入 excluded_candidates；search_notes 只写简洁检索说明。",
  ].join("\n\n");
}

export function buildEvidenceVerificationPrompt(
  request: AnalyzeRequest,
  round: number,
  allowedSourceLevels: SourceLevel[],
  allowedDomains: string[],
  candidateSnapshot: string,
): string {
  return [
    "你是阿财项目的证据核验分析器。",
    "任务是核验候选池中的每只股票在当前轮次是否具备足够证据，并输出结构化证据条目。",
    buildPolicyBlock(allowedSourceLevels, allowedDomains),
    `当前轮次: ${round}`,
    "用户条件如下：",
    buildRequestSummary(request),
    "当前候选池如下：",
    candidateSnapshot,
    "输出要求：evidence_items 只保留最关键的公开来源；supports_core_conclusion 只在来源能直接支撑核心结论时标 true；如果证据不足，要明确 missing_evidence 与 disqualify_reasons。",
  ].join("\n\n");
}

export function buildStructuredAssessmentPrompt(
  request: AnalyzeRequest,
  round: number,
  allowedSourceLevels: SourceLevel[],
  allowedDomains: string[],
  candidateSnapshot: string,
  evidenceSnapshot: string,
): string {
  return [
    "你是阿财项目的结构化结论分析器。",
    "任务是综合候选池和证据核验结果，给出本轮建议状态、候选摘要和是否继续升级轮次。",
    buildPolicyBlock(allowedSourceLevels, allowedDomains),
    `当前轮次: ${round}`,
    "用户条件如下：",
    buildRequestSummary(request),
    "候选池摘要：",
    candidateSnapshot,
    "证据核验摘要：",
    evidenceSnapshot,
    "输出要求：只有当前轮次证据足够时才能给出 HAS_CANDIDATES；若没有形成明确候选，就返回 NO_CLEAR_CANDIDATES，并准确填写 missing_evidence 与 should_escalate_to_next_round。",
  ].join("\n\n");
}
