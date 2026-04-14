import {
  AnalyzeRequestSchema,
  type AnalyzeRequest,
  investmentCycleLabelMap,
  investmentCycleValues,
  normalizeIndustryPreference,
  riskToleranceLabelMap,
  riskToleranceValues,
  stylePreferenceLabelMap,
  stylePreferenceValues,
} from "@acai/shared";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnalyzeApiError, analyze } from "../lib/api";

const defaultRequest: AnalyzeRequest = {
  budget: 50000,
  target_return_reference: 12,
  risk_tolerance: "MAX_DRAWDOWN_10",
  investment_cycle: "ONE_YEAR",
  volatility_acceptance: false,
  industry_preference: ["高股息", "家电", "出海制造"],
  style_preference: "DIVIDEND",
};

const FORM_STORAGE_KEY = "acai-form-draft";
const RESULT_STORAGE_KEY = "acai-last-result";

type FieldName = keyof AnalyzeRequest;
type FieldErrors = Partial<Record<FieldName | "request", string>>;

const industrySuggestions = [
  "高股息",
  "家电",
  "出海制造",
  "电网设备",
  "央国企",
  "消费龙头",
  "医药",
  "算力基础设施",
];

function parseIndustryTokens(value: string): string[] {
  return normalizeIndustryPreference(
    value
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean),
  );
}

function appendIndustryItems(currentItems: string[], rawValue: string): string[] {
  return normalizeIndustryPreference([...currentItems, ...parseIndustryTokens(rawValue)]).slice(0, 8);
}

function readStoredRequest(): AnalyzeRequest | null {
  try {
    const draft = sessionStorage.getItem(FORM_STORAGE_KEY);
    if (!draft) {
      return null;
    }

    const parsed = JSON.parse(draft);
    const validated = AnalyzeRequestSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function toFriendlyFieldMessage(field: string, fallback?: string): string {
  switch (field) {
    case "budget":
      return "请输入大于 0 的预算金额";
    case "target_return_reference":
      return "请输入 0 到 100 之间的目标收益参考";
    case "industry_preference":
      return fallback === "Too big: expected array to have <=8 items"
        ? "行业方向最多填写 8 个"
        : "每个行业方向请控制在 20 个字以内";
    case "risk_tolerance":
      return "请选择风险承受能力";
    case "investment_cycle":
      return "请选择投资周期";
    case "style_preference":
      return "请选择风格偏好";
    case "volatility_acceptance":
      return "请确认是否接受更高波动";
    default:
      return fallback || "请检查填写内容";
  }
}

function validateRequest(request: AnalyzeRequest): FieldErrors {
  const validated = AnalyzeRequestSchema.safeParse(request);

  if (validated.success) {
    return {};
  }

  return validated.error.issues.reduce<FieldErrors>((accumulator, issue) => {
    const field = (issue.path[0] as FieldName | undefined) ?? "request";
    if (accumulator[field]) {
      return accumulator;
    }

    accumulator[field] = toFriendlyFieldMessage(String(field), issue.message);
    return accumulator;
  }, {});
}

function buildFieldErrorsFromApi(error: AnalyzeApiError): FieldErrors {
  return error.details.reduce<FieldErrors>((accumulator, detail) => {
    const field = detail.field as FieldName | "request";
    if (accumulator[field]) {
      return accumulator;
    }

    accumulator[field] = toFriendlyFieldMessage(detail.field, detail.reason);
    return accumulator;
  }, {});
}

export function FormPage() {
  const navigate = useNavigate();
  const storedRequest = readStoredRequest();
  const [form, setForm] = useState<AnalyzeRequest>(() => storedRequest ?? defaultRequest);
  const [industryInput, setIndustryInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const industryCountText = useMemo(
    () => `当前 ${form.industry_preference.length} 个方向，最多 8 个`,
    [form.industry_preference.length],
  );

  useEffect(() => {
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  function clearFieldError(field: FieldName | "request") {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateIndustryPreference(nextItems: string[]) {
    clearFieldError("industry_preference");
    clearFieldError("request");
    setForm((current) => ({
      ...current,
      industry_preference: nextItems,
    }));
  }

  function commitIndustryInput(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setIndustryInput("");
      return;
    }

    updateIndustryPreference(appendIndustryItems(form.industry_preference, trimmed));
    setIndustryInput("");
  }

  function handleIndustryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      commitIndustryInput(industryInput);
    }

    if (event.key === "Backspace" && !industryInput && form.industry_preference.length > 0) {
      event.preventDefault();
      updateIndustryPreference(form.industry_preference.slice(0, -1));
    }
  }

  function handleIndustrySuggestionClick(item: string) {
    updateIndustryPreference(appendIndustryItems(form.industry_preference, item));
  }

  function removeIndustryItem(item: string) {
    updateIndustryPreference(form.industry_preference.filter((entry) => entry !== item));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitIndustryInput(industryInput);
    const nextForm = {
      ...form,
      industry_preference: appendIndustryItems(form.industry_preference, industryInput),
    };
    const nextFieldErrors = validateRequest(nextForm);

    setForm(nextForm);
    setFieldErrors(nextFieldErrors);
    setError(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("请先修正标红字段，再继续分析");
      return;
    }

    setSubmitting(true);

    try {
      const response = await analyze(nextForm);
      sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(response));
      navigate("/result");
    } catch (submitError) {
      if (submitError instanceof AnalyzeApiError) {
        setFieldErrors(buildFieldErrorsFromApi(submitError));
      }

      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content-grid">
      <form className="card form-card" onSubmit={handleSubmit}>
        <div className="section-heading">
          <p className="eyebrow">条件设置</p>
          <h2>先把你的边界说清楚，再进入候选筛选。</h2>
        </div>

        <label className={fieldErrors.budget ? "field has-error" : "field"}>
          <span>预算（元）</span>
          <input
            aria-invalid={Boolean(fieldErrors.budget)}
            min={1}
            step={1000}
            type="number"
            value={form.budget}
            onChange={(event) => {
              clearFieldError("budget");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                budget: Number(event.target.value),
              }));
            }}
          />
          {fieldErrors.budget ? <small className="field-error">{fieldErrors.budget}</small> : null}
        </label>

        <label className={fieldErrors.target_return_reference ? "field has-error" : "field"}>
          <span>目标收益参考（%）</span>
          <input
            aria-invalid={Boolean(fieldErrors.target_return_reference)}
            max={100}
            min={0}
            type="number"
            value={form.target_return_reference}
            onChange={(event) => {
              clearFieldError("target_return_reference");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                target_return_reference: Number(event.target.value),
              }));
            }}
          />
          {fieldErrors.target_return_reference ? (
            <small className="field-error">{fieldErrors.target_return_reference}</small>
          ) : null}
        </label>

        <label className={fieldErrors.risk_tolerance ? "field has-error" : "field"}>
          <span>风险承受能力</span>
          <select
            aria-invalid={Boolean(fieldErrors.risk_tolerance)}
            value={form.risk_tolerance}
            onChange={(event) => {
              clearFieldError("risk_tolerance");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                risk_tolerance: event.target.value as AnalyzeRequest["risk_tolerance"],
              }));
            }}
          >
            {riskToleranceValues.map((value) => (
              <option key={value} value={value}>
                {riskToleranceLabelMap[value]}
              </option>
            ))}
          </select>
          {fieldErrors.risk_tolerance ? (
            <small className="field-error">{fieldErrors.risk_tolerance}</small>
          ) : null}
        </label>

        <label className={fieldErrors.investment_cycle ? "field has-error" : "field"}>
          <span>投资周期</span>
          <select
            aria-invalid={Boolean(fieldErrors.investment_cycle)}
            value={form.investment_cycle}
            onChange={(event) => {
              clearFieldError("investment_cycle");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                investment_cycle: event.target.value as AnalyzeRequest["investment_cycle"],
              }));
            }}
          >
            {investmentCycleValues.map((value) => (
              <option key={value} value={value}>
                {investmentCycleLabelMap[value]}
              </option>
            ))}
          </select>
          {fieldErrors.investment_cycle ? (
            <small className="field-error">{fieldErrors.investment_cycle}</small>
          ) : null}
        </label>

        <label className={fieldErrors.style_preference ? "field has-error" : "field"}>
          <span>风格偏好</span>
          <select
            aria-invalid={Boolean(fieldErrors.style_preference)}
            value={form.style_preference}
            onChange={(event) => {
              clearFieldError("style_preference");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                style_preference: event.target.value as AnalyzeRequest["style_preference"],
              }));
            }}
          >
            {stylePreferenceValues.map((value) => (
              <option key={value} value={value}>
                {stylePreferenceLabelMap[value]}
              </option>
            ))}
          </select>
          {fieldErrors.style_preference ? (
            <small className="field-error">{fieldErrors.style_preference}</small>
          ) : null}
        </label>

        <label
          className={fieldErrors.volatility_acceptance ? "field checkbox-field has-error" : "field checkbox-field"}
        >
          <input
            aria-invalid={Boolean(fieldErrors.volatility_acceptance)}
            checked={form.volatility_acceptance}
            type="checkbox"
            onChange={(event) => {
              clearFieldError("volatility_acceptance");
              clearFieldError("request");
              setForm((current) => ({
                ...current,
                volatility_acceptance: event.target.checked,
              }));
            }}
          />
          <span>接受更高波动</span>
        </label>
        {fieldErrors.volatility_acceptance ? (
          <small className="field-error">{fieldErrors.volatility_acceptance}</small>
        ) : null}

        <label className={fieldErrors.industry_preference ? "field has-error" : "field"}>
          <span>行业偏好</span>
          <div className="tag-input-panel">
            <div className="tag-list" aria-live="polite">
              {form.industry_preference.map((item) => (
                <span key={item} className="tag-chip">
                  {item}
                  <button type="button" className="tag-chip-remove" onClick={() => removeIndustryItem(item)}>
                    删除
                  </button>
                </span>
              ))}
              <input
                aria-invalid={Boolean(fieldErrors.industry_preference)}
                className="tag-input"
                placeholder={
                  form.industry_preference.length >= 8
                    ? "已达到 8 个方向上限"
                    : "输入方向后按回车添加"
                }
                type="text"
                value={industryInput}
                disabled={form.industry_preference.length >= 8}
                onBlur={() => commitIndustryInput(industryInput)}
                onChange={(event) => {
                  clearFieldError("industry_preference");
                  clearFieldError("request");
                  setIndustryInput(event.target.value);
                }}
                onKeyDown={handleIndustryKeyDown}
              />
            </div>
            <div className="tag-suggestion-row">
              {industrySuggestions.map((item) => {
                const selected = form.industry_preference.includes(item);
                const disabled = selected || form.industry_preference.length >= 8;

                return (
                  <button
                    key={item}
                    type="button"
                    className={selected ? "tag-suggestion is-selected" : "tag-suggestion"}
                    disabled={disabled}
                    onClick={() => handleIndustrySuggestionClick(item)}
                  >
                    {selected ? `${item} 已添加` : `+ ${item}`}
                  </button>
                );
              })}
            </div>
          </div>
          <small className="field-note">
            {industryCountText}，支持回车、逗号或失焦添加；退格可快速删除最后一个方向
          </small>
          {fieldErrors.industry_preference ? (
            <small className="field-error">{fieldErrors.industry_preference}</small>
          ) : null}
        </label>

        {error ? <p className="error-message">{error}</p> : null}
        {fieldErrors.request ? <p className="error-message">{fieldErrors.request}</p> : null}

        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "分析中..." : "提交分析"}
        </button>
      </form>

      <aside className="card side-panel">
        <p className="eyebrow">当前分析方式</p>
        <ul className="bullet-list">
          <li>高收益目标超出周期合理阈值时，会先被规则拦截</li>
          <li>低回撤、题材偏好和高波动主题组合会被判定为条件冲突</li>
          <li>规则通过后，当前占位搜索阶段会返回“已有候选”或“暂无明确候选”</li>
        </ul>
      </aside>
    </section>
  );
}
