# 阿财 项目交接文档 V1

版本：V1

状态：可继续开发

更新时间：2026-04-14

## 1. 交接目的

这份文档用于把当前仓库的真实工程状态交接给下一个 AI 或开发者，重点解决两件事：

- 不再沿用已经过时的“只有文档、没有工程实现”的判断
- 把“已落地代码”“已验证项”“未完成风险”明确分开

## 2. 项目一句话

`阿财` 是一个基于公开信息的 A 股候选股票筛选与研读辅助工具。

它不是荐股工具，不做收益承诺，不给确定性买卖建议。

## 3. 当前仓库真实状态

当前仓库已经是正式 monorepo，不再只是文档和静态原型。

当前目录结构：

- `apps/web`：React + Vite 前端
- `apps/worker`：Cloudflare Worker 接口、规则引擎、Responses Pipeline 骨架、写库入口
- `packages/shared`：前后端共享枚举、类型、标签映射、Zod schema
- `supabase/migrations`：V1 精简版数据库建表 SQL
- `docs`：产品、技术、接口、存储、计划、交接文档
- `prototype`：早期静态原型参考

## 4. 已定且仍有效的产品约束

以下内容仍然有效，不建议在未充分讨论前推翻：

### 4.1 页面结构

- 首页独立
- 表单页独立
- 结果页独立
- 首页不承载表单
- 表单页不承载结果

### 4.2 固定业务状态

产品只允许 4 种业务状态：

- `信息不足`
- `目标偏高或条件冲突`
- `暂无明确候选`
- `已有候选`

不要新增新的业务状态名。

### 4.3 结果页约束

- 必须回显本次条件摘要
- 候选必须逐只独立展示
- 每只股票必须有自己的置信度
- 每只股票必须有自己的来源链接列表
- 来源必须可点击，不能只显示来源等级标签

### 4.4 搜索与证据原则

- 先规则判断，再进入搜索编排
- 优先一级来源，再逐步升级到二级、三级
- 四级来源只补背景，不作为核心候选结论成立依据
- 证据不足时，宁可不给明确候选

### 4.5 历史记录边界

- V1 不做用户侧历史记录页面
- 系统侧要保留匿名分析记录，便于复盘和迭代

## 5. 当前代码已经落地的内容

下面这部分以代码现状为准。

### 5.1 基础工程

- Root workspace 已建立
- `npm` workspaces 已可同时管理 `web`、`worker`、`shared`
- TypeScript 基础配置已建立
- 前端和 Worker 的本地环境变量示例文件已存在

### 5.2 共享契约层

`packages/shared` 已包含第一版共享能力：

- 请求类型与响应类型
- 4 个业务状态枚举
- 错误码枚举
- 中文标签映射
- `AnalyzeRequestSchema`
- `AnalyzeSuccessResponseSchema`
- `AnalyzeErrorResponseSchema`
- `RuleResultSchema`

### 5.3 Worker 主流程

`apps/worker` 已有完整的最小闭环：

- `GET /health`
- `POST /api/v1/analyze`
- JSON 解析与 400 错误返回
- 请求规范化
- 本地规则判断
- 分轮 Responses Pipeline 骨架
- 最终响应组装
- 数据库可选写入

当前实际执行链路：

1. 解析并校验请求
2. 规范化请求
3. 执行规则引擎
4. 规则通过时进入 Responses Pipeline
5. 组装固定结构响应
6. 若存在数据库连接配置，则写入 `client_sessions / analysis_records / analysis_candidates / candidate_evidence`

### 5.4 Responses Pipeline 现状

这里是“真实 provider 已接线，但还没完成真实 API 联调”的状态。

已落地内容：

- Round 1~4 的轮次配置
- `CandidateNarrowingSchema`
- `EvidenceVerificationSchema`
- `StructuredAssessmentSchema`
- 轮次 trace 结构
- Orchestrator
- mock provider
- OpenAI Responses provider 接线与 provider 选择层
- 分阶段 prompt 模板
- 基于来源等级的域名 allowlist 映射
- Worker 侧证据标准化、按链接去重与有效性过滤
- Evidence Gatekeeper 已接入主流程，会对候选做来源等级、域名、核心证据数量和置信度匹配校验
- Round 4 已补充 `L4` 仅可做背景补充、不得支撑核心结论的后置仲裁逻辑
- 根据证据结果决定升级轮次或收敛结果

未落地内容：

- 用真实 `OPENAI_API_KEY` 验证 OpenAI Responses API 调用链路
- 基于真实 `web_search` 返回结果复核来源域名白名单与等级过滤覆盖度
- Round 4 背景信息在最终结果中的单独承载方式仍未细化

### 5.5 数据库存储链路

存储层已经不是纯设计稿，已经有第一版代码接线：

- `supabase/migrations/20260413_230000_analysis_schema.sql` 已存在
- Worker 已有 `pg` 客户端接入代码
- 已支持从 `SUPABASE_CONNECTION_STRING` 或 `HYPERDRIVE.connectionString` 解析连接串
- 写库入口 `persistAnalysisBundle` 已接在主流程里
- 已补 `npm run db:smoke --workspace @acai/worker` 本地 smoke 脚本
- 已用真实 Supabase 连接串跑通 migration 与事务内 probe write 验证
- 成功路径下会写入 4 张主表

但要注意：

- Hyperdrive 只是预留配置，还没完成 Cloudflare 侧绑定
- 已补上游模型失败和请求校验失败场景的 `analysis_records` 失败留痕，但还没有覆盖所有失败阶段

### 5.6 前端页面现状

`apps/web` 已可运行，且不是纯静态壳。

已落地内容：

- React Router 三页结构
- 介绍页
- 表单页
- 结果页
- 基础视觉样式
- 前端 API client
- 表单提交到 Worker
- 结果响应写入 `sessionStorage`
- 表单草稿自动保存在 `sessionStorage`
- 表单字段级错误展示
- 行业偏好标签式输入与快捷建议
- 结果页“修改条件重新分析”入口
- 结果页证据展开 / 收起交互
- 四种业务状态的差异化结果区
- 结果页按固定结构渲染状态、条件摘要、候选卡片、来源链接

未完成内容：

- 更细的加载态与异常态
- 正式产品化文案和视觉打磨
- 完整移动端验收

## 6. 2026-04-14 已验证结果

以下命令在当前工作区已验证通过：

- `npm run typecheck`
- `npm run build:web`
- `npm run db:smoke --workspace @acai/worker`

说明：

- 当前可确认前端能构建
- 当前可确认 TypeScript 检查通过
- 当前可确认 Supabase migration 与 4 张分析表写入链路已完成真实库 smoke 验证
- 尚未补充自动化测试
- 尚未验证真实 OpenAI 调用链路

## 7. 当前开发阶段判断

基于代码现状，更准确的阶段判断如下：

- Phase 0 基础工程：`已完成`
- Phase 1 契约与接口骨架：`已完成`
- Phase 2 规则引擎与本地闭环：`进行中偏后段`
- Phase 3 Responses Pipeline：`进行中`
- Phase 4 前端页面与联调：`进行中`
- Phase 5 测试、观测、上线准备：`未开始`

不要再把当前仓库判断成“尚未进入工程实现”。

## 8. 当前最关键的缺口

这部分是下一位接手者最需要知道的真实风险。

### 8.1 模型链路仍是假实现

虽然 Responses Pipeline 已经补上真实 OpenAI provider 接线，但当前还没有用真实 `OPENAI_API_KEY` 跑过联调验证。

这意味着：

- 当前默认仍可能回退到 mock provider
- OpenAI `web_search` 实际调用还没有真实联调记录
- 虽然 Worker 已补 gatekeeper、去重和域名校验，但对真实搜索返回结果的覆盖度还没验证

### 8.2 数据库链路已接线并完成首轮真实验证

写库代码已经完成首轮真实验证：

- migration 已执行验证
- Worker 连 Supabase 的真实联通验证已完成

但仍有这些边界未完成：

- Hyperdrive 还没有完成 Cloudflare 侧绑定
- 存储自身失败场景还没有完整留痕

### 8.3 前端仍在从开发态向可演示版本过渡

前端基础流程已通，最近已补上字段级错误展示、结果页回表单重编辑和证据展开交互，但仍有这些缺口：

- 介绍页与结果页文案仍可继续产品化打磨
- 移动端还没有完整验收

### 8.4 测试还没有开始

当前仓库没有系统化测试：

- 没有规则单测
- 没有 Worker 单测
- 没有前端组件测试
- 没有 E2E 主流程测试

### 8.5 有少量旧 mock 文件未清理

`apps/worker/src/analysis/mockCandidates.ts` 和 `apps/worker/src/analysis/mockSearchStage.ts` 目前看起来已不在主流程中使用，后续可以清理或确认是否保留。

## 9. 建议的继续推进顺序

建议按下面顺序继续，而不是同时散开做：

1. 先验证真实 Responses provider
   - 填入 `OPENAI_API_KEY`
   - 用真实请求跑通 OpenAI Responses API + `web_search`
   - 校验三段 Structured Outputs 都能稳定返回
   - 复核真实搜索返回的来源域名是否都能被当前 gatekeeper 正确识别
2. 然后补 Round 4 与结果细化
   - 背景补充信息如何进入最终结果
   - 是否需要把 gatekeeper 拒绝原因进一步结构化暴露
3. 再补前端产品化
   - 继续打磨正式文案与移动端体验
   - 系统异常页与异常流转
   - 方向偏好多选交互优化
4. 最后补测试和上线准备

## 10. 接手时优先阅读的文件

如果是继续开发，建议先看这些：

1. `README.md`
2. `docs/prd-v1.md`
3. `docs/technical-design-v1.md`
4. `docs/api-contract-v1.md`
5. `docs/responses-schemas-v1.md`
6. `docs/data-storage-v1.md`
7. `apps/worker/src/index.ts`
8. `apps/worker/src/responses/orchestrator.ts`
9. `apps/worker/src/responses/types.ts`
10. `apps/worker/src/storage/analysisRecords.ts`
11. `apps/web/src/pages/FormPage.tsx`
12. `apps/web/src/pages/ResultPage.tsx`
13. `supabase/migrations/20260413_230000_analysis_schema.sql`

## 11. 当前一句话结论

当前项目已经从“可联调工程骨架阶段”推进到“数据库已验证、真实模型待联调阶段”。

最适合的下一步不是回到抽象讨论，而是优先打通：

- 真实 OpenAI Responses API 联调
- 证据门槛与来源治理
- 测试与异常路径
