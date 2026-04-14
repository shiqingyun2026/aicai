import type { AnalyzeSuccessResponse, StatusCode } from "@acai/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function readStoredResult(): AnalyzeSuccessResponse | null {
  try {
    const raw = sessionStorage.getItem("acai-last-result");
    return raw ? (JSON.parse(raw) as AnalyzeSuccessResponse) : null;
  } catch {
    return null;
  }
}

const conditionSummaryLabels: Record<keyof AnalyzeSuccessResponse["condition_summary"], string> = {
  budget: "预算",
  target_return_reference: "目标收益参考",
  risk_tolerance: "风险承受能力",
  investment_cycle: "投资周期",
  volatility_acceptance: "波动接受度",
  style_preference: "风格偏好",
  industry_preference: "行业偏好",
};

const statusContentMap: Record<
  StatusCode,
  {
    eyebrow: string;
    helper: string;
    reasonsTitle: string;
    suggestionsTitle: string;
    missingTitle: string;
    toneClassName: string;
  }
> = {
  INSUFFICIENT_INFO: {
    eyebrow: "需要先补输入",
    helper: "当前信息不足，系统不会贸然进入候选搜索。",
    reasonsTitle: "为什么本轮停止在规则阶段",
    suggestionsTitle: "优先补齐这些输入",
    missingTitle: "当前缺失",
    toneClassName: "status-banner-insufficient",
  },
  TARGET_TOO_HIGH_OR_CONFLICT: {
    eyebrow: "先调整边界",
    helper: "当前收益目标或条件组合存在明显冲突，继续检索的价值不高。",
    reasonsTitle: "冲突点说明",
    suggestionsTitle: "建议先这样调整",
    missingTitle: "需要重新平衡",
    toneClassName: "status-banner-conflict",
  },
  NO_CLEAR_CANDIDATES: {
    eyebrow: "这轮没有形成明确候选",
    helper: "系统已经做过当前轮次检索，但证据强度还不够支撑明确结论。",
    reasonsTitle: "为什么暂时不给候选",
    suggestionsTitle: "下一步建议",
    missingTitle: "还缺哪些证据",
    toneClassName: "status-banner-no-candidate",
  },
  HAS_CANDIDATES: {
    eyebrow: "本轮已形成候选",
    helper: "这些结果更适合作为继续研读的起点，不是直接的买卖建议。",
    reasonsTitle: "本轮形成候选的依据",
    suggestionsTitle: "继续研读时建议先看",
    missingTitle: "仍需继续核对",
    toneClassName: "status-banner-has-candidate",
  },
};

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function ResultPage() {
  const result = readStoredResult();
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({});

  const statusContent = useMemo(
    () => (result ? statusContentMap[result.status_code] : null),
    [result],
  );

  if (!result) {
    return (
      <section className="card empty-state">
        <p className="eyebrow">还没有结果</p>
        <h2>还没有可展示的分析结果。</h2>
        <p className="lead">先提交一次条件表单，系统才会生成本轮分析状态、条件摘要和候选信息。</p>
        <Link className="primary-button" to="/form">
          前往表单页
        </Link>
      </section>
    );
  }

  const supportItems =
    result.status_code === "HAS_CANDIDATES"
      ? result.analysis.suggestions.length > 0
        ? result.analysis.suggestions
        : ["优先核对一级来源中的年报、公告和经营现金流披露。"]
      : result.analysis.suggestions.length > 0
        ? result.analysis.suggestions
        : ["建议调整条件后重新分析。"];

  const missingItems = [
    ...result.analysis.missing_fields.map((item) => `字段待补充：${item}`),
    ...result.analysis.missing_evidence.map((item) => `证据待补充：${item}`),
  ];

  function toggleEvidence(candidateId: string) {
    setExpandedCandidates((current) => ({
      ...current,
      [candidateId]: !current[candidateId],
    }));
  }

  return (
    <section className="result-stack">
      <div className={`card status-banner ${statusContent?.toneClassName ?? ""}`}>
        <p className="eyebrow">{statusContent?.eyebrow}</p>
        <div className="status-row">
          <div className="status-content">
            <h2>{result.status_label}</h2>
            <p className="lead">{result.analysis.overall_note}</p>
            <p className="field-note">{statusContent?.helper}</p>
          </div>
          <span className="status-chip">{result.status_code}</span>
        </div>
        <div className="meta-chip-row">
          <span className="meta-chip">
            {result.meta.rules_passed ? "规则通过，已进入检索" : "仅规则判断，未进入检索"}
          </span>
          <span className="meta-chip">搜索轮次 {result.meta.search_rounds_used}</span>
          <span className="meta-chip">
            核心来源上限{" "}
            {result.meta.highest_source_level_used_for_core_conclusion ?? "未形成核心证据"}
          </span>
          <span className="meta-chip">生成于 {formatGeneratedAt(result.meta.generated_at)}</span>
        </div>
        <div className="button-row result-actions">
          <Link className="secondary-button" to="/form">
            修改条件重新分析
          </Link>
        </div>
      </div>

      <div className="content-grid">
        <div className="card">
          <p className="eyebrow">条件摘要</p>
          <dl className="summary-grid">
            {Object.entries(result.condition_summary).map(([key, field]) => (
              <div key={key}>
                <dt>{conditionSummaryLabels[key as keyof AnalyzeSuccessResponse["condition_summary"]]}</dt>
                <dd>{Array.isArray(field.label) ? field.label.join("、") : field.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card">
          <p className="eyebrow">{statusContent?.reasonsTitle}</p>
          <ul className="bullet-list">
            {result.analysis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="field-note">{result.risk_notice}</p>
        </div>
      </div>

      <div className="content-grid result-support-grid">
        <div className="card">
          <p className="eyebrow">{statusContent?.suggestionsTitle}</p>
          <ul className="bullet-list">
            {supportItems.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>

        <div className="card">
          <p className="eyebrow">{statusContent?.missingTitle}</p>
          {missingItems.length > 0 ? (
            <ul className="bullet-list">
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="lead">当前没有额外缺口提示，可以继续围绕已有线索往下研读。</p>
          )}
        </div>
      </div>

      <div className="result-stack">
        {result.candidates.length === 0 ? (
          <div className="card empty-candidate-card">
            <p className="eyebrow">当前没有形成候选</p>
            <h3>这轮先不强行给出股票名单。</h3>
            <p className="lead">
              {result.status_code === "INSUFFICIENT_INFO"
                ? "先把关键输入补齐，再让系统进入后续检索和证据判断。"
                : result.status_code === "TARGET_TOO_HIGH_OR_CONFLICT"
                  ? "先调整收益目标或冲突条件，再分析会更有价值。"
                  : "当前公开信息强度还不足，继续补证据比仓促给候选更稳妥。"}
            </p>
            <ul className="bullet-list">
              {supportItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          result.candidates.map((candidate) => (
            <article key={candidate.candidate_id} className="card candidate-card">
              <div className="status-row">
                <div>
                  <p className="eyebrow">{candidate.industry}</p>
                  <h3>
                    {candidate.stock_name} <span className="code-inline">{candidate.stock_code}</span>
                  </h3>
                </div>
                <div className="confidence-block">
                  <strong>{candidate.confidence_level}</strong>
                  <span>{candidate.confidence_score} / 100</span>
                </div>
              </div>
              <div className="candidate-badges">
                <span className="meta-chip">来源 {candidate.source_links.length} 条</span>
                <span className="meta-chip">
                  核心证据 {candidate.source_links.filter((item) => item.is_core_evidence).length} 条
                </span>
              </div>
              <p>{candidate.selection_reason}</p>
              <p className="field-note">{candidate.evidence_summary}</p>
              <div className="candidate-detail-grid">
                <div className="detail-panel">
                  <p className="eyebrow">主要风险</p>
                  <p>{candidate.major_risks}</p>
                </div>
                <div className="detail-panel">
                  <p className="eyebrow">不确定性</p>
                  <p>{candidate.uncertainties}</p>
                </div>
              </div>
              <button
                className="secondary-button evidence-toggle"
                type="button"
                onClick={() => toggleEvidence(candidate.candidate_id)}
              >
                {expandedCandidates[candidate.candidate_id] ? "收起证据细节" : "展开证据细节"}
              </button>
              {expandedCandidates[candidate.candidate_id] ? (
                <div className="card inset-card evidence-panel">
                  <p className="eyebrow">来源证据</p>
                  <ul className="evidence-list">
                    {candidate.source_links.map((source) => (
                      <li key={source.evidence_id} className="evidence-item">
                        <div className="evidence-item-header">
                          <a href={source.url} rel="noreferrer" target="_blank">
                            [{source.source_level}] {source.source_name} / {source.title}
                          </a>
                          <span className={source.is_core_evidence ? "evidence-badge is-core" : "evidence-badge"}>
                            {source.is_core_evidence ? "核心证据" : "补充背景"}
                          </span>
                        </div>
                        <p className="field-note">
                          {source.source_domain} · {source.publish_date}
                        </p>
                        <p>{source.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
