# 阿财 细化开发任务清单 V1

版本：V1

状态：执行中

更新时间：2026-04-14

关联文档：

- `docs/project-development-plan-v1.md`
- `docs/prd-v1.md`
- `docs/technical-design-v1.md`
- `docs/api-contract-v1.md`
- `docs/responses-schemas-v1.md`
- `docs/data-storage-v1.md`
- `docs/ai-handoff-v1.md`

## 1. 说明

这份文档用于同步当前开发任务的真实状态。

状态定义：

- `已完成`：代码已经落地，且当前工作区已有基础验证
- `进行中`：已经有代码或配置，但还没达到阶段完成标准
- `未开始`：还没有开始编码或接线
- `阻塞`：依赖外部环境、账号权限或上游决策

## 2. 当前进度快照

截至 2026-04-14，当前可以确认的事实：

- monorepo 工程结构已建立
- `apps/web`、`apps/worker`、`packages/shared` 已联通
- `/health` 和 `/api/v1/analyze` 已落地
- Worker 已接入请求校验、请求规范化、规则引擎、Responses Pipeline 骨架、响应组装、可选写库
- Responses Pipeline 的 3 段 schema 和 round orchestrator 已落地
- 当前 provider 仍是 mock，不是 OpenAI Responses API
- 数据库存储代码已接线，但 migration 和真实连接尚未验证
- 前端三页结构、表单提交流程、结果页结构渲染已落地
- `npm run typecheck` 已通过
- `npm run build:web` 已通过

当前最关键的未完成项：

- 真实 OpenAI Responses provider
- 真实 `web_search` 检索与来源门槛
- Supabase / Hyperdrive 真实联通验证
- 失败路径写库
- 前端字段级错误、证据交互、正式产品化打磨
- 自动化测试

## 3. 总体阶段进度

### 3.1 Phase 0：项目启动与基线冻结

- 状态：`已完成`

### 3.2 Phase 1：接口契约与骨架落地

- 状态：`已完成`

### 3.3 Phase 2：规则引擎与本地闭环

- 状态：`进行中`

已完成：

- 请求规范化
- 规则阈值与冲突判断第一版
- 固定结构结果组装
- Worker 主路由闭环
- 成功路径写库入口接线

未完成：

- 规则单元测试
- 配置外置化
- 失败路径记录

### 3.4 Phase 3：Responses Pipeline 与证据门槛

- 状态：`进行中`

已完成：

- Candidate Narrowing / Evidence Verification / Structured Assessment schema
- Round 1~4 配置骨架
- orchestrator
- round trace
- mock provider

未完成：

- 真实 OpenAI Responses API
- 真正的来源等级过滤和域名策略
- 证据去重与 gatekeeper
- Round 4 背景补充专门逻辑

### 3.5 Phase 4：前端开发与联调

- 状态：`进行中`

已完成：

- 三页路由
- 表单提交
- 结果页结构渲染
- Worker 基础联调

未完成：

- 字段级错误
- 更完整异常态
- 结果页交互细化
- 正式视觉与文案

### 3.6 Phase 5：测试、观测与上线准备

- 状态：`未开始`

## 4. 细化任务清单

## 4.1 基础工程与共享层

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `BASE-01` | 建立 monorepo 目录结构 | 已完成 | 已有 `apps/web`、`apps/worker`、`packages/shared` |
| `BASE-02` | 配置 root workspace scripts | 已完成 | 根目录 `package.json` 已可运行 `dev:web`、`dev:worker`、`build:web`、`typecheck` |
| `BASE-03` | 配置 TypeScript 基础能力 | 已完成 | `tsconfig.base.json` 与子项目配置已落地 |
| `BASE-04` | 补充 lint 和 format 命令 | 未开始 | 当前没有 ESLint / Prettier |
| `BASE-05` | 补充统一环境变量说明 | 进行中 | `apps/web/.env.example` 和 `apps/worker/.dev.vars.example` 已存在，但缺少统一说明文档 |
| `BASE-06` | 清理不应提交的构建产物 | 进行中 | 当前 `apps/web/dist` 存在，需决定是否纳入仓库管理 |
| `BASE-07` | 清理废弃 mock 辅助文件 | 进行中 | `apps/worker/src/analysis/mockCandidates.ts`、`mockSearchStage.ts` 看起来不在主流程中使用 |

## 4.2 共享契约与接口层

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `CONTRACT-01` | 生成请求类型定义 | 已完成 | 已落地在 `packages/shared` |
| `CONTRACT-02` | 生成成功响应类型定义 | 已完成 | 已落地 |
| `CONTRACT-03` | 生成错误响应类型定义 | 已完成 | 已落地 |
| `CONTRACT-04` | 生成状态枚举和中文映射 | 已完成 | 已落地 |
| `CONTRACT-05` | 生成规则结果结构定义 | 已完成 | 已落地 |
| `CONTRACT-06` | 补齐 Responses Schemas 常量 | 已完成 | 已落地在 `apps/worker/src/responses/types.ts` |
| `CONTRACT-07` | 补齐更细的字段级 schema 校验 | 进行中 | 当前请求/响应/规则 schema 已有，仍缺更细的 UI 字段级映射与阶段参数约束 |
| `CONTRACT-08` | 生成 mock 数据专用模块 | 已完成 | 已有 `apps/worker/src/responses/providers/mockProvider.ts` |

## 4.3 Worker 接口与规则引擎

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `WORKER-01` | 建立 `/health` 接口 | 已完成 | 已落地 |
| `WORKER-02` | 建立 `/api/v1/analyze` 路由 | 已完成 | 已落地 |
| `WORKER-03` | 实现 JSON 请求解析与 400 错误返回 | 已完成 | 已落地 |
| `WORKER-04` | 实现请求规范化 | 已完成 | 已有 `normalize.ts` |
| `WORKER-05` | 实现信息不足判断 | 已完成 | 已落地 |
| `WORKER-06` | 实现目标偏高阈值判断 | 已完成 | 已落地第一版 |
| `WORKER-07` | 实现条件冲突判断 | 已完成 | 已落地第一版 |
| `WORKER-08` | 实现规则结果统一结构 | 已完成 | 已落地 |
| `WORKER-09` | 实现结果组装器 | 已完成 | 已有 `resultComposer.ts` |
| `WORKER-10` | 输出 `INSUFFICIENT_INFO` 真实结果 | 已完成 | 已可返回 |
| `WORKER-11` | 输出 `TARGET_TOO_HIGH_OR_CONFLICT` 真实结果 | 已完成 | 已可返回 |
| `WORKER-12` | 输出 `NO_CLEAR_CANDIDATES` 结构化结果 | 已完成 | 当前由 Responses mock provider + orchestrator 返回 |
| `WORKER-13` | 输出 `HAS_CANDIDATES` 结构化结果 | 已完成 | 当前由 Responses mock provider + orchestrator 返回 |
| `WORKER-14` | 规则配置外置化 | 未开始 | 当前阈值和主题词仍写在代码里 |
| `WORKER-15` | 规则引擎单元测试 | 未开始 | 尚未建立测试目录 |
| `WORKER-16` | 错误处理中间件整理 | 进行中 | 目前以函数组织为主，尚未抽成更正式的错误处理层 |

## 4.4 Responses Pipeline 与证据编排

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `RESP-01` | 建立 Candidate Narrowing schema 常量 | 已完成 | 已落地 |
| `RESP-02` | 建立 Evidence Verification schema 常量 | 已完成 | 已落地 |
| `RESP-03` | 建立 Structured Assessment schema 常量 | 已完成 | 已落地 |
| `RESP-04` | 建立 Round 1 调用逻辑 | 已完成 | 已由 orchestrator + provider 第一版承载 |
| `RESP-05` | 建立 Round 2 调用逻辑 | 已完成 | 已由 orchestrator + provider 第一版承载 |
| `RESP-06` | 建立 Round 3 调用逻辑 | 已完成 | 已由 orchestrator + provider 第一版承载 |
| `RESP-07` | 建立 Round 4 背景补充逻辑 | 未开始 | 当前只有 round 配置，没有“仅补背景不参与核心结论”的专门实现 |
| `RESP-08` | 建立轮次升级规则控制 | 进行中 | 已有 `should_escalate_to_next_round`，但逻辑仍较简化 |
| `RESP-09` | 建立来源等级过滤 | 进行中 | 当前只有 `allowedSourceLevels` 结构传递，没有真实域名策略与级别映射校验 |
| `RESP-10` | 建立证据去重与标准化 | 未开始 | 待实现 |
| `RESP-11` | 建立 Evidence Gatekeeper | 未开始 | 待实现 |
| `RESP-12` | 建立 Prompt 模板和调用参数组织 | 未开始 | 当前未接真实 Responses API |
| `RESP-13` | 接入真实 OpenAI Responses provider | 未开始 | 当前默认仍是 mock provider |

## 4.5 数据库与写库链路

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `DATA-01` | 校验 Supabase migration 可执行性 | 未开始 | SQL 已存在，尚未执行验证 |
| `DATA-02` | 配置 Supabase 连接方式 | 进行中 | 已有 `SUPABASE_CONNECTION_STRING` 环境位和连接解析逻辑 |
| `DATA-03` | 配置 Hyperdrive | 进行中 | `wrangler.jsonc` 已预留注释配置，但未完成真实绑定 |
| `DATA-04` | 建立 `analysis_records` 写入 | 进行中 | 已有插入代码并接在主流程，未做真实库验证 |
| `DATA-05` | 建立 `analysis_candidates` 写入 | 进行中 | 已有插入代码并接在主流程，未做真实库验证 |
| `DATA-06` | 建立 `candidate_evidence` 写入 | 进行中 | 已有插入代码并接在主流程，未做真实库验证 |
| `DATA-07` | 建立失败路径记录 | 未开始 | 当前仅成功路径入库 |
| `DATA-08` | 建立请求与响应回放字段映射 | 已完成 | `normalized_request_json`、`rule_results_json`、`round_trace_json`、`final_response_json` 已接通 |

## 4.6 前端工程与页面开发

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `FE-01` | 建立 React + Vite 前端工程 | 已完成 | 已落地 |
| `FE-02` | 建立前端路由结构 | 已完成 | `/`、`/form`、`/result` 已落地 |
| `FE-03` | 建立全局样式和基础视觉壳层 | 已完成 | 已有基础样式 |
| `FE-04` | 迁移并整理 Google Stitch 设计产物 | 未开始 | 当前页面为自写 scaffold，不是 Stitch 产物整理结果 |
| `FE-05` | 建立 API client | 已完成 | 已落地 `src/lib/api.ts` |
| `FE-06` | 实现介绍页正式内容 | 进行中 | 当前可用，但仍偏开发态说明 |
| `FE-07` | 实现表单页字段布局 | 已完成 | 已落地基础版 |
| `FE-08` | 实现表单字段即时校验 | 未开始 | 当前主要依赖后端校验 |
| `FE-09` | 实现表单字段中文文案与提示优化 | 进行中 | 基础文案已写，但还未产品化打磨 |
| `FE-10` | 实现方向偏好多选交互优化 | 未开始 | 当前仍是 textarea 拆分输入 |
| `FE-11` | 实现提交按钮加载态 | 已完成 | 已有 `分析中...` |
| `FE-12` | 实现接口失败提示 | 已完成 | 已有基础错误提示 |
| `FE-13` | 实现字段级错误展示 | 未开始 | 当前未做字段级映射 |
| `FE-14` | 实现结果页状态横幅 | 进行中 | 当前有状态区，但仍是基础版 |
| `FE-15` | 实现条件摘要模块 | 已完成 | 已落地基础版 |
| `FE-16` | 实现候选卡片组件 | 已完成 | 已落地基础版 |
| `FE-17` | 实现置信度展示组件 | 已完成 | 已落地基础版 |
| `FE-18` | 实现来源链接列表组件 | 已完成 | 已落地基础版 |
| `FE-19` | 实现证据展开区交互 | 未开始 | 当前为静态列表 |
| `FE-20` | 实现四种业务状态的差异化渲染 | 进行中 | 已能渲染，但展示层次和文案仍需细化 |
| `FE-21` | 实现结果页空态与无结果建议 | 已完成 | 已有基础版 |
| `FE-22` | 实现从结果页返回表单重编辑 | 未开始 | 当前缺少正式“修改条件”入口 |
| `FE-23` | 实现系统异常页或统一异常区 | 未开始 | 待实现 |
| `FE-24` | 实现移动端适配完善 | 进行中 | 基础响应式已做，尚未验收 |
| `FE-25` | 清理开发态展示文案 | 未开始 | 仍可见 `Acai V1 Scaffold` 等开发态文案 |

## 4.7 前后端联调

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `INTEG-01` | 前端接入真实 Worker 地址 | 已完成 | 已通过 `VITE_API_BASE_URL` 对接 |
| `INTEG-02` | 前端提交真实请求并消费响应 | 已完成 | 基础流程已打通 |
| `INTEG-03` | 联调规则拦截场景 | 进行中 | 可人工触发，但尚未沉淀标准联调样例 |
| `INTEG-04` | 联调 `NO_CLEAR_CANDIDATES` 场景 | 进行中 | 当前依赖 mock provider |
| `INTEG-05` | 联调 `HAS_CANDIDATES` 场景 | 进行中 | 当前依赖 mock provider |
| `INTEG-06` | 联调写库成功路径 | 进行中 | 代码已接线，但未验证真实数据库 |
| `INTEG-07` | 联调上游失败和超时路径 | 未开始 | 真实模型和真实超时处理尚未接入 |

## 4.8 测试、观测与发布准备

| 编号 | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `QA-01` | 建立 Worker 单元测试框架 | 未开始 | 待实现 |
| `QA-02` | 建立规则测试用例 | 未开始 | 待实现 |
| `QA-03` | 建立结果结构测试用例 | 未开始 | 待实现 |
| `QA-04` | 建立前端页面渲染测试 | 未开始 | 待实现 |
| `QA-05` | 建立端到端主流程测试 | 未开始 | 待实现 |
| `QA-06` | 建立日志字段和埋点清单 | 未开始 | 待实现 |
| `QA-07` | 建立发布前回归清单 | 未开始 | 待实现 |

## 5. 下一阶段最推荐执行顺序

如果接下来只做最有价值的事情，建议按下面顺序推进：

1. `DATA-01`、`DATA-04`、`INTEG-06`
   - 先把 migration 和真实写库跑通
2. `RESP-13`、`RESP-12`
   - 替换真实 OpenAI Responses provider
3. `RESP-09`、`RESP-10`、`RESP-11`
   - 完成来源等级、证据去重、gatekeeper
4. `FE-13`、`FE-19`、`FE-22`、`FE-25`
   - 把前端从开发态壳层推到可演示版本
5. `QA-01` ~ `QA-05`
   - 补最基础自动化测试

## 6. 当前一句话判断

当前项目不是“还没开始”，而是已经完成了：

- 工程骨架
- 契约层
- Worker 主流程骨架
- Responses Pipeline 第一版骨架
- 前端联调骨架

真正还没完成的是：

- 真实模型
- 真实数据库验证
- 证据门槛
- 前端产品化
- 测试体系
