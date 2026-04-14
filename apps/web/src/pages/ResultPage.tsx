import type { AnalyzeSuccessResponse } from "@acai/shared";
import { Link } from "react-router-dom";

function readStoredResult(): AnalyzeSuccessResponse | null {
  try {
    const raw = sessionStorage.getItem("acai-last-result");
    return raw ? (JSON.parse(raw) as AnalyzeSuccessResponse) : null;
  } catch {
    return null;
  }
}

export function ResultPage() {
  const result = readStoredResult();

  if (!result) {
    return (
      <section className="card empty-state">
        <p className="eyebrow">结果页</p>
        <h2>还没有可展示的分析结果。</h2>
        <p className="lead">先提交一次条件表单，再回来查看固定结构响应和候选卡片布局。</p>
        <Link className="primary-button" to="/form">
          前往表单页
        </Link>
      </section>
    );
  }

  return (
    <section className="result-stack">
      <div className="card">
        <p className="eyebrow">业务结果</p>
        <div className="status-row">
          <h2>{result.status_label}</h2>
          <span className="status-chip">{result.status_code}</span>
        </div>
        <p className="lead">{result.analysis.overall_note}</p>
      </div>

      <div className="content-grid">
        <div className="card">
          <p className="eyebrow">条件摘要</p>
          <dl className="summary-grid">
            {Object.entries(result.condition_summary).map(([key, field]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{Array.isArray(field.label) ? field.label.join("、") : field.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card">
          <p className="eyebrow">分析说明</p>
          <ul className="bullet-list">
            {result.analysis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="field-note">{result.risk_notice}</p>
        </div>
      </div>

      <div className="result-stack">
        {result.candidates.length === 0 ? (
          <div className="card">
            <p className="eyebrow">暂无候选</p>
            <ul className="bullet-list">
              {result.analysis.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
              {result.analysis.missing_evidence.map((item) => (
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
              <p>{candidate.selection_reason}</p>
              <p className="field-note">{candidate.evidence_summary}</p>
              <div className="card inset-card">
                <p className="eyebrow">来源证据</p>
                <ul className="bullet-list">
                  {candidate.source_links.map((source) => (
                    <li key={source.evidence_id}>
                      <a href={source.url} rel="noreferrer" target="_blank">
                        [{source.source_level}] {source.source_name} / {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

