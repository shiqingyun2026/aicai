# 阿财 数据存储设计 V1

版本：V1

状态：草案

更新时间：2026-04-13

关联文档：
- `docs/technical-design-v1.md`
- `docs/api-contract-v1.md`
- `docs/responses-schemas-v1.md`

## 1. 文档目的

这份文档用于明确 `阿财` V1 的数据库设计。

目标：
- 存储匿名用户的问答记录
- 支撑后续复盘、质量迭代和离线重跑
- 不改变 V1 “前端不展示历史记录”的产品边界

## 2. 存储结论

V1 建议引入数据库，不再采用纯无状态方案。

推荐方案：

- 主数据库：`Supabase Postgres`
- 连接链路：`Cloudflare Worker -> Hyperdrive -> Supabase Postgres`
- 写入入口：`Cloudflare Worker`
- 数据用途：问答留痕、结果回放、候选来源追溯、质量分析

说明：
- 当前需求是“留存问答记录，便于复盘迭代”，属于典型结构化关系数据
- 在当前技术栈下，Supabase 更适合承担关系数据与后续分析演进
- 根据 Cloudflare 官方文档，Worker 连接外部 Postgres 时优先走 Hyperdrive
- 根据 Cloudflare 的 Supabase 接入文档，Hyperdrive 应使用 Supabase 的 Direct connection，而不是 Supabase 自带 pooler 连接串

## 3. V1 精简版原则

这版存储方案明确收敛为 `V1 精简版`。

收敛策略：

- 保留对业务最关键的 4 张主表
- 不把规则结果和轮次结果拆成独立明细表
- 将规则摘要和轮次摘要收进 `analysis_records` 的 `jsonb` 字段
- 先保证“可复盘、可回放、可统计”，再追求“逐轮逐阶段的强明细化建模”

这样做的原因：

- V1 最核心的问题是“用户问了什么，系统回了什么，为什么这么回”
- 这不要求一开始就把内部每一步都拆成关系表
- 用 `jsonb` 保存规则与轮次摘要，更利于先上线再迭代

## 4. 存储范围

### 4.1 必存数据

- 匿名会话标识
- 用户提交的筛选条件
- 规则校验摘要
- 搜索轮次摘要
- 最终返回的业务状态
- 最终候选结果
- 候选来源证据链接

### 4.2 暂不要求存储

- 用户登录信息
- 账号资料
- 用户收藏
- 用户自定义股票池
- 原始完整 prompt 文本
- 每一轮模型原始响应全文

## 5. 设计原则

### 5.1 匿名优先

V1 没有登录注册，因此数据库不以账号为核心，而以匿名会话和分析记录为核心。

### 5.2 结果可回放

每次分析都必须能够追溯：

- 用户当时提交了什么条件
- 规则引擎是否放行
- 搜索走到了第几轮
- 为什么最后输出这个状态
- 候选结论依赖了哪些来源链接

### 5.3 结构化优先

优先存结构化字段，不依赖纯文本日志。

### 5.4 服务端独占访问

- 前端不直接访问 Supabase 数据库
- Worker 使用数据库专用账号连接
- V1 不通过浏览器端 `supabase-js` 直接读写这些分析表

## 6. 数据实体

V1 精简版建议只保留以下 4 张表，统一放在 `analysis` schema 下：

1. `client_sessions`
2. `analysis_records`
3. `analysis_candidates`
4. `candidate_evidence`

说明：
- `analysis_records` 是主表
- 规则结果和轮次结果不再拆成独立表
- 分别收敛到 `rule_results_json` 和 `round_trace_json`

## 7. 表设计

### 7.1 `client_sessions`

作用：
- 标识匿名用户会话
- 为后续“同一用户多次提交”的复盘提供聚合维度

字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | uuid | 主键，前端生成 UUID |
| `first_seen_at` | timestamptz | 首次出现时间 |
| `last_seen_at` | timestamptz | 最近活跃时间 |
| `locale` | text | 语言或地区 |
| `source_channel` | text | 流量来源，可选 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 7.2 `analysis_records`

作用：
- 存一条完整问答记录
- 是复盘与回放的核心主表

字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `analysis_id` | uuid | 主键 |
| `request_id` | text | 请求链路标识，唯一 |
| `session_id` | uuid | 外键，关联 `client_sessions.session_id` |
| `processing_state` | text | 写库处理状态：`received` / `completed` / `failed` |
| `status_code` | text | 最终业务状态，完成前可为空 |
| `status_label` | text | 中文状态名，完成前可为空 |
| `rules_passed` | boolean | 是否通过规则闸门，规则前可为空 |
| `rule_status_code` | text | 规则阶段结论 |
| `budget` | integer | 预算 |
| `target_return_reference` | integer | 目标收益参考 |
| `risk_tolerance` | text | 风险承受能力 |
| `investment_cycle` | text | 投资周期 |
| `volatility_acceptance` | boolean | 是否接受高波动 |
| `style_preference` | text | 风格偏好 |
| `industry_preference_json` | jsonb | 方向偏好数组 JSON |
| `normalized_request_json` | jsonb | 规范化请求体 JSON |
| `rule_results_json` | jsonb | 规则引擎摘要 JSON |
| `round_trace_json` | jsonb | 搜索轮次摘要 JSON |
| `final_response_json` | jsonb | 最终返回体 JSON，完成前可为空 |
| `search_rounds_used` | integer | 实际使用轮次 |
| `duration_ms` | integer | 总耗时 |
| `model_call_count` | integer | 模型调用次数 |
| `error_code` | text | 系统失败时记录错误码 |
| `error_message` | text | 系统失败时记录错误信息 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |
| `completed_at` | timestamptz | 完成时间，可为空 |

说明：
- 这张表直接回答“用户问了什么，系统回了什么”
- `normalized_request_json` 和 `final_response_json` 是最关键的回放字段
- `rule_results_json` 和 `round_trace_json` 是 V1 精简版的关键收敛点

### 7.3 `analysis_candidates`

作用：
- 存最终结果中的候选股票

字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `candidate_id` | uuid | 主键 |
| `analysis_id` | uuid | 外键 |
| `display_order` | integer | 展示顺序 |
| `stock_name` | text | 股票名称 |
| `stock_code` | text | 股票代码 |
| `industry` | text | 所属行业 |
| `selection_reason` | text | 入选原因 |
| `evidence_summary` | text | 核心依据摘要 |
| `major_risks` | text | 主要风险 |
| `uncertainties` | text | 不确定性说明 |
| `confidence_level` | text | HIGH / MEDIUM / LOW |
| `confidence_score` | integer | 0 到 100 |
| `created_at` | timestamptz | 创建时间 |

### 7.4 `candidate_evidence`

作用：
- 存候选的来源证据
- 支撑前端可点击引用展示和后续证据分析

字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `evidence_id` | uuid | 主键 |
| `analysis_id` | uuid | 外键 |
| `candidate_id` | uuid | 外键 |
| `source_level` | text | L1 / L2 / L3 / L4 |
| `source_name` | text | 来源名称 |
| `source_domain` | text | 来源域名 |
| `title` | text | 来源标题 |
| `url` | text | 原始链接 |
| `publish_date` | date | 发布时间 |
| `snippet` | text | 证据摘要 |
| `is_core_evidence` | boolean | 是否用于核心结论 |
| `is_valid_after_gatekeeper` | boolean | 通过后置校验后是否有效 |
| `created_at` | timestamptz | 创建时间 |

## 8. 推荐索引

建议至少建立以下索引：

- `idx_analysis_records_session_id_created_at`
- `idx_analysis_records_processing_state_created_at`
- `idx_analysis_records_status_code_created_at`
- `idx_analysis_candidates_analysis_id_display_order`
- `idx_candidate_evidence_candidate_id`
- `idx_candidate_evidence_source_domain`

## 9. 推荐建表草案

```sql
CREATE SCHEMA IF NOT EXISTS analysis;

CREATE TABLE analysis.client_sessions (
  session_id UUID PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locale TEXT,
  source_channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analysis.analysis_records (
  analysis_id UUID PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  session_id UUID REFERENCES analysis.client_sessions(session_id),
  processing_state TEXT NOT NULL,
  status_code TEXT,
  status_label TEXT,
  rules_passed BOOLEAN,
  rule_status_code TEXT,
  budget INTEGER NOT NULL,
  target_return_reference INTEGER NOT NULL,
  risk_tolerance TEXT NOT NULL,
  investment_cycle TEXT NOT NULL,
  volatility_acceptance BOOLEAN NOT NULL,
  style_preference TEXT NOT NULL,
  industry_preference_json JSONB NOT NULL,
  normalized_request_json JSONB NOT NULL,
  rule_results_json JSONB,
  round_trace_json JSONB,
  final_response_json JSONB,
  search_rounds_used INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  model_call_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE analysis.analysis_candidates (
  candidate_id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES analysis.analysis_records(analysis_id),
  display_order INTEGER NOT NULL,
  stock_name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  industry TEXT,
  selection_reason TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  major_risks TEXT NOT NULL,
  uncertainties TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analysis.candidate_evidence (
  evidence_id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES analysis.analysis_records(analysis_id),
  candidate_id UUID NOT NULL REFERENCES analysis.analysis_candidates(candidate_id),
  source_level TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  publish_date DATE,
  snippet TEXT NOT NULL,
  is_core_evidence BOOLEAN NOT NULL,
  is_valid_after_gatekeeper BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 10. 写入时机

### 10.1 提交开始时

- upsert `client_sessions`
- 写入 `analysis_records`
- 此时 `processing_state = received`
- 此时只需要保证请求体、会话和基础条件已经留痕

### 10.2 规则引擎结束时

- 更新 `analysis_records.rules_passed`
- 更新 `analysis_records.rule_status_code`
- 更新 `analysis_records.rule_results_json`
- 若规则未过，可直接写入最终 `status_code`、`status_label` 和 `final_response_json`

### 10.3 搜索流程执行时

- 将每轮摘要追加或覆盖写入 `analysis_records.round_trace_json`
- 更新 `search_rounds_used`
- 更新 `model_call_count`

### 10.4 最终组装结果时

- 更新 `analysis_records.status_code`
- 更新 `analysis_records.status_label`
- 更新 `analysis_records.final_response_json`
- 更新 `analysis_records.duration_ms`
- 更新 `analysis_records.processing_state = completed`
- 更新 `analysis_records.completed_at`
- 写入 `analysis_candidates`
- 写入 `candidate_evidence`

### 10.5 系统失败时

- 更新 `analysis_records.processing_state = failed`
- 更新 `error_code`
- 更新 `error_message`

## 11. 典型查询场景

数据库至少要支持以下查询：

1. 查看某次分析的完整问答记录
2. 查看某个匿名会话的最近提交历史
3. 统计四种业务状态分布
4. 统计规则未通过的主要原因
5. 统计哪些来源域名最常成为核心证据
6. 回放某次分析使用了哪些轮次摘要

## 12. 为什么这版不过度设计

V1 精简版的取舍是：

- 用 4 张表承载业务核心对象
- 用 2 个 `jsonb` 字段承载内部流程摘要
- 不拆独立规则表和轮次表

这意味着：

- 研发复杂度更低
- migration 更容易一次落地
- 仍然保留后续拆表演进空间

如果后续出现以下情况，再考虑升级到 V1.1：

- 需要高频统计单条规则命中率
- 需要逐轮逐阶段做复杂报表
- 需要独立回放平台
- 需要做模型和规则版本 AB 分析

## 13. 数据留存建议

V1 建议：

- 问答主记录长期保留
- 候选与证据长期保留
- `round_trace_json` 长期保留
- 若未来原始 payload 明显膨胀，再考虑把超大原始内容迁到对象存储

## 14. 隐私与合规

### 14.1 最小化原则

- 不主动采集姓名、手机号、身份证等个人信息
- 匿名会话只使用 `session_id`
- 无登录前提下，不做跨设备强识别

### 14.2 风险控制

- API Key 和模型配置不得入库到用户记录中
- 数据库中不保存前端本地密钥
- 若后续增加反馈文本，需单独评估敏感信息风险
- Supabase 的数据库密码或高权限连接串只能保存在 Worker 服务端
- 如后续开放 Supabase API 读写，必须补充 RLS 设计，不允许直接复用当前分析表权限

## 15. 演进建议

如果后续要做更重的质量体系，建议再拆以下两类表：

1. `analysis_rule_results`
   - 存单条规则命中明细
2. `analysis_rounds`
   - 存每轮每阶段的独立结构化明细

但这两类表不是 V1 必需项。
