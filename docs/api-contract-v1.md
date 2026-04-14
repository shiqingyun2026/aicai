# 阿财 接口协议 V1

版本：V1

状态：草案

更新时间：2026-04-13

关联文档：
- `docs/technical-design-v1.md`
- `docs/prd-v1.md`

## 1. 文档目的

这份文档用于将 `阿财` V1 的前后端接口协议定为可开发状态。

目标：
- 定死外部接口路径、方法和请求格式
- 定死 4 种业务状态的统一返回结构
- 区分业务失败和系统失败
- 为后续数据库留痕、复盘与回放提供稳定主键

## 2. 接口边界

V1 对前端开放的核心接口只保留 1 个：

1. `POST /api/v1/analyze`
   - 提交筛选条件
   - 执行规则校验
   - 必要时触发联网搜索
   - 返回结构化分析结果

说明：
- V1 不对前端开放历史记录查询接口
- 问答留痕进入数据库，但不在 V1 用户界面展示

## 3. 通用约定

### 3.1 请求头

前端请求时建议带上以下请求头：

- `Content-Type: application/json`
- `X-Client-Session-Id: <uuid>`
- `X-Request-Id: <uuid>`

说明：
- `X-Client-Session-Id` 由前端首次访问时生成并保存在浏览器本地，用于匿名会话留痕
- `X-Request-Id` 用于链路排查；如果前端不传，由 Worker 自动生成

### 3.2 时间与编码

- 时间统一使用 ISO 8601 UTC 字符串
- 金额单位统一为 `元`
- 收益率单位统一为 `%`
- 枚举传输使用英文代码
- 用户展示文案由返回体中的中文字段直接提供，前端不自己拼接业务话术

### 3.3 业务状态码

系统只允许返回以下 4 个业务状态码：

- `INSUFFICIENT_INFO`
- `TARGET_TOO_HIGH_OR_CONFLICT`
- `NO_CLEAR_CANDIDATES`
- `HAS_CANDIDATES`

对应中文标签：

- `INSUFFICIENT_INFO` -> `信息不足`
- `TARGET_TOO_HIGH_OR_CONFLICT` -> `目标偏高或条件冲突`
- `NO_CLEAR_CANDIDATES` -> `暂无明确候选`
- `HAS_CANDIDATES` -> `已有候选`

## 4. `POST /api/v1/analyze`

### 4.1 作用

提交一次完整筛选请求，并返回固定结构结果。

### 4.2 请求体

```json
{
  "budget": 50000,
  "target_return_reference": 12,
  "risk_tolerance": "MAX_DRAWDOWN_10",
  "investment_cycle": "ONE_YEAR",
  "volatility_acceptance": false,
  "industry_preference": ["高股息", "家电", "出海制造"],
  "style_preference": "DIVIDEND"
}
```

### 4.3 请求字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `budget` | integer | 是 | 预算，单位元 |
| `target_return_reference` | integer | 是 | 目标收益参考，单位 % |
| `risk_tolerance` | string | 是 | 风险承受能力枚举 |
| `investment_cycle` | string | 是 | 投资周期枚举 |
| `volatility_acceptance` | boolean | 是 | 是否接受高波动 |
| `industry_preference` | string[] | 否 | 方向偏好，多选 |
| `style_preference` | string | 否 | 风格偏好，默认 `BALANCED` |

### 4.4 枚举定义

#### `risk_tolerance`

- `MAX_DRAWDOWN_5`
- `MAX_DRAWDOWN_10`
- `MAX_DRAWDOWN_20`
- `MAX_DRAWDOWN_50`

#### `investment_cycle`

- `ONE_WEEK`
- `ONE_MONTH`
- `ONE_QUARTER`
- `HALF_YEAR`
- `ONE_YEAR`
- `TWO_YEARS`
- `OVER_THREE_YEARS`

#### `style_preference`

- `VALUE`
- `GROWTH`
- `DIVIDEND`
- `LEADER`
- `THEMATIC`
- `BALANCED`

### 4.5 请求校验规则

#### 基础校验

- `budget` 必须为正整数
- `target_return_reference` 必须为 0 到 100 之间整数
- 枚举字段必须命中合法值
- `industry_preference` 最多 8 项
- `industry_preference` 每个值长度不超过 20 个字符

#### 失败返回

- 基础字段格式错误返回 HTTP `400`
- 业务规则未通过返回 HTTP `200`，但业务状态为固定四态中的非候选状态

## 5. 成功响应结构

### 5.1 顶层结构

```json
{
  "request_id": "req_01",
  "analysis_id": "ana_01",
  "client_session_id": "sess_01",
  "status_code": "HAS_CANDIDATES",
  "status_label": "已有候选",
  "condition_summary": {},
  "analysis": {},
  "candidates": [],
  "risk_notice": "仅供参考，不构成投资建议",
  "meta": {}
}
```

### 5.2 顶层字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `request_id` | string | 是 | 当前请求唯一标识 |
| `analysis_id` | string | 是 | 当前分析记录唯一标识，对应数据库主键 |
| `client_session_id` | string | 否 | 匿名会话标识 |
| `status_code` | string | 是 | 四态之一 |
| `status_label` | string | 是 | 中文状态名 |
| `condition_summary` | object | 是 | 回显的规范化条件摘要 |
| `analysis` | object | 是 | 原因、建议、总体说明 |
| `candidates` | array | 是 | 候选数组，无候选时为空数组 |
| `risk_notice` | string | 是 | 固定风险声明 |
| `meta` | object | 是 | 耗时、来源轮次、调试信息摘要 |

### 5.3 `condition_summary`

```json
{
  "budget": {
    "value": 50000,
    "label": "50,000 元"
  },
  "target_return_reference": {
    "value": 12,
    "label": "12%"
  },
  "risk_tolerance": {
    "value": "MAX_DRAWDOWN_10",
    "label": "可接受最大回撤 10%"
  },
  "investment_cycle": {
    "value": "ONE_YEAR",
    "label": "一年"
  },
  "volatility_acceptance": {
    "value": false,
    "label": "尽量不接受"
  },
  "style_preference": {
    "value": "DIVIDEND",
    "label": "红利"
  },
  "industry_preference": {
    "value": ["高股息", "家电", "出海制造"],
    "label": ["高股息", "家电", "出海制造"]
  }
}
```

### 5.4 `analysis`

```json
{
  "reasons": [
    "你的条件未出现明显冲突，因此系统进入公开信息检索阶段"
  ],
  "suggestions": [
    "优先查看一级来源的经营与分红披露"
  ],
  "overall_note": "结果仅用于继续研读方向，不构成买卖建议",
  "missing_fields": [],
  "missing_evidence": []
}
```

字段规则：

- `reasons`：面向用户的原因分析
- `suggestions`：面向用户的下一步建议
- `overall_note`：总体说明
- `missing_fields`：仅 `INSUFFICIENT_INFO` 场景可非空
- `missing_evidence`：仅搜索证据不足场景可非空

### 5.5 `candidates`

```json
[
  {
    "candidate_id": "cand_01",
    "stock_name": "美的集团",
    "stock_code": "000333",
    "industry": "家电",
    "selection_reason": "与一年周期、红利偏好和低波动倾向更匹配",
    "evidence_summary": "公开年报和公告可验证经营现金流与分红连续性",
    "major_risks": "出口节奏与原材料波动可能压缩利润弹性",
    "uncertainties": "仍需继续确认后续需求与公司指引",
    "confidence_level": "HIGH",
    "confidence_score": 78,
    "primary_source_levels": ["L1", "L2"],
    "source_links": [
      {
        "evidence_id": "ev_01",
        "source_level": "L1",
        "source_name": "巨潮资讯",
        "source_domain": "cninfo.com.cn",
        "title": "2025 年年度报告",
        "url": "https://www.cninfo.com.cn/...",
        "publish_date": "2026-03-29",
        "snippet": "用于确认收入结构、经营现金流与分红延续性",
        "is_core_evidence": true
      }
    ]
  }
]
```

字段规则：

- `confidence_level` 仅允许 `HIGH`、`MEDIUM`、`LOW`
- `confidence_score` 为 0 到 100 整数
- `source_links` 必须可点击，且保留实际引用 URL
- 单次返回候选数量最多 5 只

### 5.6 `meta`

```json
{
  "rules_passed": true,
  "search_rounds_used": 2,
  "highest_source_level_used_for_core_conclusion": "L2",
  "duration_ms": 4820,
  "generated_at": "2026-04-13T14:25:00Z"
}
```

说明：
- `meta` 给前端做轻量展示或埋点，不作为核心业务文案来源

## 6. 四种业务状态返回约束

### 6.1 `INSUFFICIENT_INFO`

返回要求：

- `candidates` 必须为空数组
- `analysis.missing_fields` 必须非空
- `analysis.reasons` 必须说明信息缺失
- `analysis.suggestions` 必须给出补充建议

### 6.2 `TARGET_TOO_HIGH_OR_CONFLICT`

返回要求：

- `candidates` 必须为空数组
- `analysis.reasons` 必须包含冲突或过高目标说明
- `analysis.suggestions` 必须给出调整方向

### 6.3 `NO_CLEAR_CANDIDATES`

返回要求：

- `candidates` 可以为空数组
- `analysis.missing_evidence` 应说明为何无法形成明确候选
- `analysis.suggestions` 必须给出下一步研究建议

### 6.4 `HAS_CANDIDATES`

返回要求：

- `candidates` 至少 1 只，最多 5 只
- 每只候选必须有自己的 `confidence_level`
- 每只候选必须有自己的 `source_links`

## 7. 错误响应协议

### 7.1 顶层结构

```json
{
  "request_id": "req_01",
  "error": {
    "code": "INVALID_REQUEST",
    "message": "budget 必须为正整数",
    "details": [
      {
        "field": "budget",
        "reason": "must_be_positive_integer"
      }
    ]
  }
}
```

### 7.2 错误码

| HTTP | 错误码 | 说明 |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | 请求字段格式错误 |
| `401` | `UNAUTHORIZED` | 鉴权失败，仅内部接口使用 |
| `429` | `RATE_LIMITED` | 请求过于频繁 |
| `502` | `UPSTREAM_FAILURE` | 上游模型或搜索调用失败 |
| `500` | `INTERNAL_ERROR` | Worker 内部异常 |

说明：
- 业务规则未通过不属于错误，不返回 4xx
- 业务规则未通过时仍然返回 HTTP `200`

## 8. 幂等与回放

### 8.1 幂等要求

- V1 不要求强幂等
- 但建议前端在同一页面提交中禁用重复点击
- Worker 应记录每次实际分析请求，供复盘使用

### 8.2 回放标识

以下字段必须进入数据库：

- `analysis_id`
- `client_session_id`
- `request_id`
- 规范化请求体
- 最终响应体

这样后续可以做到：

- 复盘某次回答为何得到当前结论
- 对比不同模型或不同规则版本的结果差异
- 做离线重跑和质量评估

说明：
- 当前主记录会进入 Supabase Postgres
- 前端依旧不开放历史记录查询能力

## 9. 前后端联调约定

前端必须依赖以下字段，不自行推测：

- `status_code`
- `status_label`
- `condition_summary`
- `analysis`
- `candidates`
- `risk_notice`

前端不得自行做以下事情：

- 根据文案猜测状态
- 自行补齐候选来源
- 自行拼装置信度
- 把无链接的来源标签当作真实证据展示

## 10. 推荐后续动作

如果进入开发阶段，下一步建议继续补：

1. TypeScript 类型定义
2. Zod 或 JSON Schema 校验定义
3. Worker 路由和错误处理中间件约定
