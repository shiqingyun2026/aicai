import {
  type AnalyzeRequest,
  investmentCycleLabelMap,
  investmentCycleValues,
  riskToleranceLabelMap,
  riskToleranceValues,
  stylePreferenceLabelMap,
  stylePreferenceValues,
} from "@acai/shared";
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyze } from "../lib/api";

const defaultRequest: AnalyzeRequest = {
  budget: 50000,
  target_return_reference: 12,
  risk_tolerance: "MAX_DRAWDOWN_10",
  investment_cycle: "ONE_YEAR",
  volatility_acceptance: false,
  industry_preference: ["高股息", "家电", "出海制造"],
  style_preference: "DIVIDEND",
};

export function FormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<AnalyzeRequest>(defaultRequest);
  const [industryInput, setIndustryInput] = useState(form.industry_preference.join("、"));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const industryCountText = useMemo(
    () => `当前 ${form.industry_preference.length} 个方向，最多 8 个`,
    [form.industry_preference.length],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await analyze(form);
      sessionStorage.setItem("acai-last-result", JSON.stringify(response));
      navigate("/result");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content-grid">
      <form className="card form-card" onSubmit={handleSubmit}>
        <div className="section-heading">
          <p className="eyebrow">表单页</p>
          <h2>把输入、规则和搜索边界分清楚。</h2>
        </div>

        <label className="field">
          <span>预算（元）</span>
          <input
            min={1}
            step={1000}
            type="number"
            value={form.budget}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                budget: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className="field">
          <span>目标收益参考（%）</span>
          <input
            max={100}
            min={0}
            type="number"
            value={form.target_return_reference}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                target_return_reference: Number(event.target.value),
              }))
            }
          />
        </label>

        <label className="field">
          <span>风险承受能力</span>
          <select
            value={form.risk_tolerance}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                risk_tolerance: event.target.value as AnalyzeRequest["risk_tolerance"],
              }))
            }
          >
            {riskToleranceValues.map((value) => (
              <option key={value} value={value}>
                {riskToleranceLabelMap[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>投资周期</span>
          <select
            value={form.investment_cycle}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                investment_cycle: event.target.value as AnalyzeRequest["investment_cycle"],
              }))
            }
          >
            {investmentCycleValues.map((value) => (
              <option key={value} value={value}>
                {investmentCycleLabelMap[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>风格偏好</span>
          <select
            value={form.style_preference}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                style_preference: event.target.value as AnalyzeRequest["style_preference"],
              }))
            }
          >
            {stylePreferenceValues.map((value) => (
              <option key={value} value={value}>
                {stylePreferenceLabelMap[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="field checkbox-field">
          <input
            checked={form.volatility_acceptance}
            type="checkbox"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                volatility_acceptance: event.target.checked,
              }))
            }
          />
          <span>接受更高波动</span>
        </label>

        <label className="field">
          <span>行业偏好</span>
          <textarea
            rows={4}
            value={industryInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setIndustryInput(nextValue);

              const nextItems = nextValue
                .split(/[、,，\n]/)
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 8);

              setForm((current) => ({
                ...current,
                industry_preference: nextItems,
              }));
            }}
          />
          <small>{industryCountText}</small>
        </label>

        {error ? <p className="error-message">{error}</p> : null}

        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "分析中..." : "提交分析"}
        </button>
      </form>

      <aside className="card side-panel">
        <p className="eyebrow">当前默认逻辑</p>
        <ul className="bullet-list">
          <li>高收益目标超出周期合理阈值时，会先被规则拦截</li>
          <li>低回撤、题材偏好和高波动主题组合会被判定为条件冲突</li>
          <li>规则通过后，当前占位搜索阶段会返回“已有候选”或“暂无明确候选”</li>
        </ul>
      </aside>
    </section>
  );
}
