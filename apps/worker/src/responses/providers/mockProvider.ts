import type { AnalyzeRequest, SourceLevel } from "@acai/shared";
import type {
  CandidateNarrowingOutput,
  EvidenceVerificationOutput,
  ResponsesProvider,
  StructuredAssessmentOutput,
} from "../types";

function isThematicRequest(request: AnalyzeRequest): boolean {
  return (
    request.style_preference === "THEMATIC" ||
    request.industry_preference.some((item) => item.includes("主题"))
  );
}

function buildCoreCandidate(request: AnalyzeRequest) {
  return {
    stock_name: "美的集团",
    stock_code: "000333",
    industry: request.industry_preference[0] ?? "家电",
    selection_thesis: "与一年期、红利偏好、相对稳健波动要求更匹配。",
    preliminary_match_points: [
      "公开披露较完整",
      "适合优先验证经营现金流与分红延续性",
      "行业位置清晰，便于多来源交叉验证",
    ],
  };
}

function buildEvidenceLevels(allowedSourceLevels: SourceLevel[]) {
  const evidence = [];

  if (allowedSourceLevels.includes("L1")) {
    evidence.push({
      source_level: "L1" as const,
      source_name: "巨潮资讯",
      source_domain: "cninfo.com.cn",
      title: "2025 年年度报告",
      url: "https://www.cninfo.com.cn/",
      publish_date: "2026-03-29",
      snippet: "用于确认经营现金流、分红连续性和主营结构。",
      supports_core_conclusion: true,
    });
  }

  if (allowedSourceLevels.includes("L2")) {
    evidence.push({
      source_level: "L2" as const,
      source_name: "上海证券报",
      source_domain: "cnstock.com",
      title: "家电龙头经营韧性观察",
      url: "https://www.cnstock.com/",
      publish_date: "2026-04-08",
      snippet: "用于补充行业位置和市场公开解读。",
      supports_core_conclusion: false,
    });
  }

  if (allowedSourceLevels.includes("L3")) {
    evidence.push({
      source_level: "L3" as const,
      source_name: "券商研报摘要",
      source_domain: "example-research.local",
      title: "行业景气跟踪摘要",
      url: "https://example-research.local/",
      publish_date: "2026-04-10",
      snippet: "用于补充行业景气变化背景。",
      supports_core_conclusion: false,
    });
  }

  return evidence;
}

export const mockResponsesProvider: ResponsesProvider = {
  async runCandidateNarrowing({ allowedSourceLevels, request, round }): Promise<CandidateNarrowingOutput> {
    const thematic = isThematicRequest(request);

    return {
      round,
      stage: "candidate_narrowing",
      allowed_source_levels: allowedSourceLevels,
      candidate_pool: thematic ? [buildCoreCandidate(request)] : [buildCoreCandidate(request)],
      excluded_candidates: [],
      search_notes: thematic
        ? ["主题风格请求会优先检查高波动方向是否存在足够高质量披露。"]
        : ["先从法定披露和公开事实源收敛候选。"],
    };
  },

  async runEvidenceVerification({
    allowedSourceLevels,
    candidateNarrowing,
    request,
    round,
  }): Promise<EvidenceVerificationOutput> {
    const thematic = isThematicRequest(request);
    const evidenceItems = buildEvidenceLevels(allowedSourceLevels);
    const sufficient = !thematic && allowedSourceLevels.includes("L2");

    return {
      round,
      stage: "evidence_verification",
      allowed_source_levels: allowedSourceLevels,
      candidate_evaluations: candidateNarrowing.candidate_pool.map((candidate) => ({
        stock_name: candidate.stock_name,
        stock_code: candidate.stock_code,
        is_qualified_in_current_round: sufficient,
        source_level_coverage: evidenceItems.map((item) => item.source_level),
        evidence_items: evidenceItems,
        missing_evidence: sufficient ? [] : ["仍缺少更稳定的跨来源经营与分红支撑。"],
        disqualify_reasons: sufficient ? [] : ["当前轮次证据覆盖仍不足。"],
      })),
      evidence_sufficient: sufficient,
      missing_evidence: sufficient ? [] : ["当前轮次仍缺少足够的一二级证据组合。"],
      should_escalate_to_next_round: !sufficient && round < 3,
    };
  },

  async runStructuredAssessment({
    allowedSourceLevels,
    evidenceVerification,
    request,
    round,
  }): Promise<StructuredAssessmentOutput> {
    const thematic = isThematicRequest(request);
    const sufficient = evidenceVerification.evidence_sufficient;

    if (!sufficient && thematic && round >= 3) {
      return {
        round,
        stage: "structured_assessment",
        allowed_source_levels: allowedSourceLevels,
        proposed_status: "NO_CLEAR_CANDIDATES",
        qualified_candidates: [],
        rejected_candidates: evidenceVerification.candidate_evaluations.map((item) => ({
          stock_name: item.stock_name,
          stock_code: item.stock_code,
          reason: "多轮检索后仍未形成足够扎实的高质量证据覆盖。",
        })),
        reasons: ["多轮公开信息检索后，当前条件下仍没有形成明确候选。"],
        suggestions: ["建议缩窄方向范围，优先选择披露更充分的行业后重试。"],
        overall_note: "结果仅用于继续研读方向，不构成投资建议",
        evidence_sufficient: false,
        missing_evidence: ["一级与二级来源中的核心经营证据仍不足。"],
        should_escalate_to_next_round: false,
      };
    }

    if (!sufficient) {
      return {
        round,
        stage: "structured_assessment",
        allowed_source_levels: allowedSourceLevels,
        proposed_status: "NO_CLEAR_CANDIDATES",
        qualified_candidates: [],
        rejected_candidates: [],
        reasons: ["当前轮次证据仍不足，建议继续升级来源范围。"],
        suggestions: ["继续补充更高覆盖度的公开来源后再决定是否形成候选。"],
        overall_note: "结果仅用于继续研读方向，不构成投资建议",
        evidence_sufficient: false,
        missing_evidence: evidenceVerification.missing_evidence,
        should_escalate_to_next_round: round < 3,
      };
    }

    return {
      round,
      stage: "structured_assessment",
      allowed_source_levels: allowedSourceLevels,
      proposed_status: "HAS_CANDIDATES",
      qualified_candidates: [
        {
          stock_name: "美的集团",
          stock_code: "000333",
          industry: request.industry_preference[0] ?? "家电",
          selection_reason: "与一年周期、红利偏好和低波动倾向更匹配。",
          evidence_summary: "公开年报和公告可验证经营现金流、分红延续性和业务稳定度。",
          major_risks: "原材料波动和外部需求节奏变化可能影响利润弹性。",
          uncertainties: "仍需继续核对公司后续经营指引和行业景气变化。",
          confidence_level: "HIGH",
          confidence_score: 78,
        },
      ],
      rejected_candidates: [],
      reasons: ["公开信息检索已形成满足当前门槛的候选。"],
      suggestions: ["优先阅读一级来源中的年报、公告和经营现金流披露。"],
      overall_note: "结果仅用于继续研读方向，不构成投资建议",
      evidence_sufficient: true,
      missing_evidence: [],
      should_escalate_to_next_round: false,
    };
  },
};

