import { type AnalyzeSuccessResponse } from "@acai/shared";
import { makeUuid } from "../lib/ids";

export function buildMockCandidates(): AnalyzeSuccessResponse["candidates"] {
  return [
    {
      candidate_id: makeUuid(),
      stock_name: "美的集团",
      stock_code: "000333",
      industry: "家电",
      selection_reason: "与一年周期、红利偏好和低波动倾向更匹配。",
      evidence_summary: "公开年报和公告可验证经营现金流、分红延续性和业务稳定度。",
      major_risks: "原材料波动和外部需求节奏变化可能影响利润弹性。",
      uncertainties: "仍需继续核对公司后续经营指引和行业景气变化。",
      confidence_level: "HIGH",
      confidence_score: 78,
      primary_source_levels: ["L1", "L2"],
        source_links: [
          {
            evidence_id: makeUuid(),
          source_level: "L1",
          source_name: "巨潮资讯",
          source_domain: "cninfo.com.cn",
          title: "2025 年年度报告",
          url: "https://www.cninfo.com.cn/",
          publish_date: "2026-03-29",
          snippet: "用于确认经营现金流、分红连续性和主营结构。",
          is_core_evidence: true,
          },
          {
            evidence_id: makeUuid(),
          source_level: "L2",
          source_name: "上海证券报",
          source_domain: "cnstock.com",
          title: "家电龙头经营韧性观察",
          url: "https://www.cnstock.com/",
          publish_date: "2026-04-08",
          snippet: "用于补充行业位置和市场对基本面变化的公开解读。",
          is_core_evidence: false,
        },
      ],
    },
  ];
}
