# 阿财 Responses Pipeline Schemas V1

版本：V1

状态：草案

更新时间：2026-04-13

关联文档：
- `docs/technical-design-v1.md`
- `docs/api-contract-v1.md`

## 1. 文档目的

这份文档用于定死 Worker 内部调用 OpenAI Responses API 时使用的 Structured Outputs 契约。

目标：
- 把“模型输出”限制为严格 JSON Schema
- 把“是否升级到下一轮”变成结构化字段，而不是提示词上的模糊判断
- 把 Worker 的后置仲裁建立在稳定字段之上

## 2. 总体原则

### 2.1 强制要求

- 每次 Responses API 调用都必须使用 Structured Outputs
- 必须通过 `text.format = { "type": "json_schema", ... }` 指定 schema
- Worker 必须对响应结果再次做 schema 校验
- 校验失败不得透传给前端

### 2.2 禁止事项

- 禁止用纯文本格式约束替代 schema
- 禁止让模型直接输出最终前端响应
- 禁止让模型直接决定四级来源能否参与核心结论

## 3. 调用编排总览

建议按以下顺序编排：

1. `Round N / Candidate Narrowing`
2. `Round N / Evidence Verification`
3. `Round N / Structured Assessment`
4. Worker 判断是否升级到下一轮

轮次升级顺序：

1. `Round 1`
   - `allowed_domains = L1`
2. `Round 2`
   - `allowed_domains = L1 + L2`
3. `Round 3`
   - `allowed_domains = L1 + L2 + L3`
4. `Round 4`
   - `allowed_domains = L1 + L2 + L3 + L4`
   - 但 `L4` 只允许补背景，不允许支撑核心候选结论

## 4. 公共字段约定

以下字段建议出现在每一轮每一阶段的 schema 中：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `round` | integer | 当前轮次，1 到 4 |
| `stage` | string | 当前阶段名 |
| `allowed_source_levels` | string[] | 当前允许使用的来源等级 |
| `candidate_pool` | array | 当前阶段识别到的候选池 |
| `evidence_sufficient` | boolean | 当前轮次证据是否足够 |
| `missing_evidence` | string[] | 当前仍缺失的关键信息 |
| `should_escalate_to_next_round` | boolean | 是否进入下一轮 |
| `proposed_status` | string | 模型建议状态，仅供 Worker 参考 |

## 5. Schema 1: Candidate Narrowing

### 5.1 作用

根据输入条件和当前允许来源范围，给出候选池与初筛理由。

### 5.2 Schema 名称

- `acai_candidate_narrowing_v1`

### 5.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "round",
    "stage",
    "allowed_source_levels",
    "candidate_pool",
    "excluded_candidates",
    "search_notes"
  ],
  "properties": {
    "round": { "type": "integer", "minimum": 1, "maximum": 4 },
    "stage": { "type": "string", "const": "candidate_narrowing" },
    "allowed_source_levels": {
      "type": "array",
      "items": { "type": "string", "enum": ["L1", "L2", "L3", "L4"] }
    },
    "candidate_pool": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "stock_name",
          "stock_code",
          "industry",
          "selection_thesis",
          "preliminary_match_points"
        ],
        "properties": {
          "stock_name": { "type": "string" },
          "stock_code": { "type": "string" },
          "industry": { "type": "string" },
          "selection_thesis": { "type": "string" },
          "preliminary_match_points": {
            "type": "array",
            "items": { "type": "string" },
            "maxItems": 5
          }
        }
      }
    },
    "excluded_candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "reason"],
        "properties": {
          "name": { "type": "string" },
          "reason": { "type": "string" }
        }
      }
    },
    "search_notes": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 5
    }
  }
}
```

### 5.4 Worker 处理规则

- 候选池超过 12 只时按优先级裁剪
- `stock_code` 不合法的候选直接剔除
- 当前阶段不产生最终业务状态

## 6. Schema 2: Evidence Verification

### 6.1 作用

验证候选池的来源证据，并判断每只候选当前轮次是否达标。

### 6.2 Schema 名称

- `acai_evidence_verification_v1`

### 6.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "round",
    "stage",
    "allowed_source_levels",
    "candidate_evaluations",
    "evidence_sufficient",
    "missing_evidence",
    "should_escalate_to_next_round"
  ],
  "properties": {
    "round": { "type": "integer", "minimum": 1, "maximum": 4 },
    "stage": { "type": "string", "const": "evidence_verification" },
    "allowed_source_levels": {
      "type": "array",
      "items": { "type": "string", "enum": ["L1", "L2", "L3", "L4"] }
    },
    "candidate_evaluations": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "stock_name",
          "stock_code",
          "is_qualified_in_current_round",
          "source_level_coverage",
          "evidence_items",
          "missing_evidence",
          "disqualify_reasons"
        ],
        "properties": {
          "stock_name": { "type": "string" },
          "stock_code": { "type": "string" },
          "is_qualified_in_current_round": { "type": "boolean" },
          "source_level_coverage": {
            "type": "array",
            "items": { "type": "string", "enum": ["L1", "L2", "L3", "L4"] }
          },
          "evidence_items": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "source_level",
                "source_name",
                "source_domain",
                "title",
                "url",
                "publish_date",
                "snippet",
                "supports_core_conclusion"
              ],
              "properties": {
                "source_level": { "type": "string", "enum": ["L1", "L2", "L3", "L4"] },
                "source_name": { "type": "string" },
                "source_domain": { "type": "string" },
                "title": { "type": "string" },
                "url": { "type": "string" },
                "publish_date": { "type": "string" },
                "snippet": { "type": "string" },
                "supports_core_conclusion": { "type": "boolean" }
              }
            }
          },
          "missing_evidence": {
            "type": "array",
            "items": { "type": "string" }
          },
          "disqualify_reasons": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "evidence_sufficient": { "type": "boolean" },
    "missing_evidence": {
      "type": "array",
      "items": { "type": "string" }
    },
    "should_escalate_to_next_round": { "type": "boolean" }
  }
}
```

### 6.4 Worker 处理规则

- `L4` 证据即使存在，也不得单独作为核心结论依据
- `url` 域名不在当前白名单时，该证据项记为无效
- 单个候选不满足当前轮次最低门槛时，从最终候选池移除

## 7. Schema 3: Structured Assessment

### 7.1 作用

基于验证后的证据结构，给出候选结论建议和是否升级下一轮的判断。

### 7.2 Schema 名称

- `acai_structured_assessment_v1`

### 7.3 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
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
    "should_escalate_to_next_round"
  ],
  "properties": {
    "round": { "type": "integer", "minimum": 1, "maximum": 4 },
    "stage": { "type": "string", "const": "structured_assessment" },
    "allowed_source_levels": {
      "type": "array",
      "items": { "type": "string", "enum": ["L1", "L2", "L3", "L4"] }
    },
    "proposed_status": {
      "type": "string",
      "enum": [
        "INSUFFICIENT_INFO",
        "TARGET_TOO_HIGH_OR_CONFLICT",
        "NO_CLEAR_CANDIDATES",
        "HAS_CANDIDATES"
      ]
    },
    "qualified_candidates": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "stock_name",
          "stock_code",
          "industry",
          "selection_reason",
          "evidence_summary",
          "major_risks",
          "uncertainties",
          "confidence_level",
          "confidence_score"
        ],
        "properties": {
          "stock_name": { "type": "string" },
          "stock_code": { "type": "string" },
          "industry": { "type": "string" },
          "selection_reason": { "type": "string" },
          "evidence_summary": { "type": "string" },
          "major_risks": { "type": "string" },
          "uncertainties": { "type": "string" },
          "confidence_level": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] },
          "confidence_score": { "type": "integer", "minimum": 0, "maximum": 100 }
        }
      }
    },
    "rejected_candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["stock_name", "stock_code", "reason"],
        "properties": {
          "stock_name": { "type": "string" },
          "stock_code": { "type": "string" },
          "reason": { "type": "string" }
        }
      }
    },
    "reasons": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 6
    },
    "suggestions": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 6
    },
    "overall_note": { "type": "string" },
    "evidence_sufficient": { "type": "boolean" },
    "missing_evidence": {
      "type": "array",
      "items": { "type": "string" }
    },
    "should_escalate_to_next_round": { "type": "boolean" }
  }
}
```

### 7.4 Worker 处理规则

- `qualified_candidates` 只允许保留通过后置仲裁的候选
- `proposed_status = HAS_CANDIDATES` 但候选为空时，Worker 必须降级
- `confidence_level = HIGH` 时，必须存在符合门槛的高质量证据覆盖

## 8. 轮次升级规则

Worker 应按以下规则决定是否进入下一轮：

### 8.1 可以停止的情况

- 已有满足门槛的候选
- 已明确判定为 `NO_CLEAR_CANDIDATES`
- 已到 `Round 4`
- 已超出总超时阈值

### 8.2 必须升级的情况

- 当前轮次没有合格候选，但仍存在明确待补证据
- 当前轮次只拿到低等级来源，无法支持核心结论
- 当前轮次模型明确返回 `should_escalate_to_next_round = true`

## 9. Worker 后置仲裁最小规则集

Worker 至少要做以下校验：

1. schema 校验通过
2. 枚举值合法
3. `stock_code` 合法
4. 引用链接存在且可解析域名
5. 引用域名属于本轮允许范围
6. 四级来源未被用于核心结论
7. 候选数不超过 5
8. 高置信度不与低证据覆盖冲突

## 10. 推荐实现方式

推荐在 Worker 内部定义以下模块：

- `schema/candidate-narrowing.ts`
- `schema/evidence-verification.ts`
- `schema/structured-assessment.ts`
- `pipeline/run-round.ts`
- `pipeline/validate-round-output.ts`
- `pipeline/compose-final-result.ts`
