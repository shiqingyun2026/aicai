# 阿财 工程骨架

这是 `阿财` 项目的正式工程起点，目标是把现有 `docs/` 和 `prototype/` 中已经定下来的内容，逐步落成可开发、可联调的代码结构。

## 当前结构

```text
apps/
  web/      React + Vite 前端壳层
  worker/   Cloudflare Worker 编排入口
packages/
  shared/   前后端共享契约、枚举和校验
docs/       产品与技术文档
prototype/  静态原型参考
supabase/   数据库 migration
```

## 当前已完成

- Root workspace 和基础 TypeScript 配置
- `web`、`worker`、`shared` 三层目录结构
- `/api/v1/analyze` 的最小 mock 路由
- 前端介绍页、表单页、结果页的基础路由和提交流程
- 基于接口文档整理的共享请求/响应类型与校验
- 已拆出请求规范化、规则引擎和结果组装的 Worker 模块骨架
- 已补 `analysis_records`、`analysis_candidates`、`candidate_evidence` 的数据库写入入口
- 已建立 Responses 分轮编排骨架，当前默认走 mock provider

## 推荐启动方式

1. 在项目根目录执行 `npm install`
2. 启动 Worker：`npm run dev:worker`
3. 启动前端：`npm run dev:web`

说明：
- `apps/web/.env.example` 提供前端本地环境变量示例
- `apps/worker/.dev.vars.example` 提供 Worker 本地环境变量示例
- 当前 `/api/v1/analyze` 已接入本地规则判断、分轮编排骨架和三张分析表写库入口
- 如果未配置 `SUPABASE_CONNECTION_STRING` 或 Hyperdrive 绑定，Worker 会跳过数据库写入，仅保留接口响应

## 下一步建议

1. 把 `packages/shared` 里的契约继续补齐为完整 Zod schema
2. 验证 `supabase/migrations/20260413_230000_analysis_schema.sql`
3. 把 `apps/worker/src/responses/providers/mockProvider.ts` 替换成真实 OpenAI Responses provider
4. 为分轮编排补充 schema 校验、上游异常处理和测试
