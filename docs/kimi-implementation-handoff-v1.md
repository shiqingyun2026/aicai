# 阿财 Kimi 接入实施交接清单 V1

版本：V1

状态：进行中

更新时间：2026-04-16

## 1. 本次交接目标

将当前阿财 Worker 的 Kimi 接入方案，从“模型自主工具调用”切换为“Worker 显式调用 Kimi Formula web-search，Kimi 只负责推理和结构化输出”，并同步记录截至 2026-04-16 的真实实现状态与联调结论。

## 2. 当前结论

### 2.1 已确认事项

- `kimi-k2.5` 基础 `chat/completions` 调用可用
- `thinking: enabled` 与 `response_format: { "type": "json_object" }` 可用
- Kimi Formula 官方工具存在独立协议，不是 OpenAI `Responses API`
- `GET /formulas/moonshot/web-search:latest/tools` 可拿到 `tools` 数组
- `POST /formulas/moonshot/web-search:latest/fibers` 的正确入参是：
  - `name`
  - `arguments`
- `arguments` 需要是 JSON 字符串，例如 `"{\"query\":\"...\"}"`
- `encrypted_output` 是 Fiber 返回内容的一部分，不是 Fiber 请求参数

### 2.2 当前实现结论

当前仓库已经完成 Kimi 主路径重构：

```text
Worker 显式调用 Formula web-search
  -> 提取 search_context
  -> 将 search_context 注入 prompt
  -> kimi-k2.5 输出 JSON
  -> 本地 normalize + Zod 校验
  -> 必要时 repair
  -> gatekeeper 后置过滤
```

已经不再依赖“模型自己决定要不要 tool_call”。

### 2.3 当前真实联调结论

截至 2026-04-16，真实本地联调已经确认：

- Formula `tools` 可调用成功
- Formula `fibers` 可调用成功
- `candidate_narrowing` 可跑通真实搜索与 completion
- `evidence_verification` 在减载后可跑通真实搜索与 completion
- `structured_assessment` 也可跑到 completion
- 当前主要剩余问题不是协议错误，而是 Kimi completion 延迟波动较大，真实请求仍可能命中 `90s` 超时

换句话说，当前阻塞点已经从“接法不对”收敛为“时延和成功率优化”。

## 3. 当前代码已完成内容

### 3.1 已完成的核心重构

- `apps/worker/src/responses/providers/kimiProvider.ts`
  - 已删除旧的“模型自主 `tool_calls` 主路径”
  - 已切换为 Worker 显式调用 Formula 搜索
  - 已增加阶段 query 构造、搜索日志、completion、repair、超时控制
  - 已增加本地 normalize，用于吞掉常见字段漂移
- `apps/worker/src/responses/types.ts`
  - 已新增 provider stage trace 类型
  - 已新增 `search_context` 对应结构
  - `ResponsesProvider` 已切换为返回 `output + trace`
- `apps/worker/src/responses/orchestrator.ts`
  - 已接入 stage trace
- `apps/worker/src/responses/prompts.ts`
  - 已新增 `search_context` 注入格式
- `apps/worker/src/responses/sourcePolicy.ts`
  - 已新增基于域名推断来源等级的辅助逻辑
- `apps/worker/.dev.vars.example`
  - 已补 `KIMI_WEB_SEARCH_FORMULA`
- `README.md`
  - 已同步 Kimi 显式搜索前置方案说明

### 3.2 已完成的真实调优

为了提高 Kimi 真实联调成功率，已经补了这些减载和容错：

- 控制单阶段最大 query 数量
- 压缩 `search_context` 注入条数
- 限制 raw tool payload 注入条数
- `structured_assessment` 默认优先复用前序证据
- 本地 normalize 常见 Kimi 字段漂移，包括：
  - `stage`
  - `sector -> industry`
  - `reason -> selection_thesis / selection_reason`
  - `stock_code` 带 `.SZ/.SH`
  - `search_notes` 字符串转数组

## 4. 当前联调中观测到的真实问题

### 4.1 已解决的问题

- 旧的 Kimi `tool_calls` 路径不稳定
- Fiber 请求错误地把 `encrypted_output` 当作入参
- `candidate_narrowing` 常见字段漂移导致的大量 schema 校验失败
- `evidence_verification` 因输入过重造成的稳定性较差问题，经过减载后已有成功记录

### 4.2 当前仍未完全解决的问题

#### 问题 1：Kimi completion 延迟波动大

真实请求仍可能返回：

```text
kimi_request_timeout:90000:https://api.moonshot.cn/v1/chat/completions
```

这说明：

- 当前完整三阶段链路仍然偏重
- Kimi completion 的时延有明显波动
- 同一组请求参数在某次能通过，在另一轮可能仍会超时

#### 问题 2：repair 仍不适合作为常态兜底

虽然本地 normalize 已经吞掉不少小偏差，但如果还需要走远程 repair，请求仍可能因为：

```text
kimi_request_timeout:15000:https://api.moonshot.cn/v1/chat/completions
```

而失败。

当前判断：

- repair 应尽量只作为最后兜底
- 更推荐继续加强本地 normalize 和阶段降载

#### 问题 3：失败路径写库不稳定

在上游超时失败时，偶发还会出现：

```text
persist_failed_analysis_record_failed Error: Connection terminated unexpectedly
```

这说明：

- 失败留痕链路在当前本地联调场景下不完全稳定
- 这不是 Kimi 协议主问题，但会影响失败态观测

## 5. 当前验收状态

### 5.1 已达到

- `RESPONSES_PROVIDER=kimi` 时 Worker 能正常启动
- Formula `tools` 与 `fibers` 协议已确认并可调用
- 显式搜索前置方案已在代码中落地
- 三阶段 orchestrator 已能实际驱动 Kimi provider
- `candidate_narrowing` 真实 completion 可成功
- `evidence_verification` 真实 completion 有成功记录
- `structured_assessment` 已至少跑到 completion

### 5.2 尚未达到

- 完整 `/api/v1/analyze` 还没有稳定返回一次业务成功响应
- 当前仍可能因 Kimi completion 超时而返回 `502 UPSTREAM_FAILURE`
- 失败路径写库还没有完全稳定

## 6. 当前最值得继续做的事情

建议下一位接手者优先按这个顺序继续：

### 任务 1：继续降低 Kimi completion 负载

- 将 `candidate_narrowing` query 再减到最小必要数量
- `structured_assessment` 尽量完全复用前序证据，避免补搜索
- 继续压缩 `search_context`
- 必要时只保留摘要，不保留 raw tool payload

### 任务 2：增加 provider 级超时降级策略

当前更实用的策略是：

```text
若某阶段 Kimi 超时
  -> 不直接返回 502
  -> 回退为结构化的 NO_CLEAR_CANDIDATES
  -> 明确 missing_evidence / suggestions
```

这样可以先保证 `/api/v1/analyze` 业务响应稳定，再逐步追求高质量候选。

### 任务 3：继续扩大本地 normalize 覆盖面

目前 normalize 已经证明有效，值得继续沿这个方向扩展，而不是把小问题交给远程 repair。

### 任务 4：补失败路径观测

- 检查 `persist_failed_analysis_record_failed`
- 让本地/开发态失败留痕更稳定

## 7. 当前涉及的关键文件

- [apps/worker/src/responses/providers/kimiProvider.ts](/Users/yun/选股%20demo/apps/worker/src/responses/providers/kimiProvider.ts)
- [apps/worker/src/responses/orchestrator.ts](/Users/yun/选股%20demo/apps/worker/src/responses/orchestrator.ts)
- [apps/worker/src/responses/prompts.ts](/Users/yun/选股%20demo/apps/worker/src/responses/prompts.ts)
- [apps/worker/src/responses/sourcePolicy.ts](/Users/yun/选股%20demo/apps/worker/src/responses/sourcePolicy.ts)
- [apps/worker/src/responses/types.ts](/Users/yun/选股%20demo/apps/worker/src/responses/types.ts)
- [apps/worker/src/storage/types.ts](/Users/yun/选股%20demo/apps/worker/src/storage/types.ts)
- [apps/worker/.dev.vars.example](/Users/yun/选股%20demo/apps/worker/.dev.vars.example)
- [README.md](/Users/yun/选股%20demo/README.md)

## 8. 最终一句话判断

截至 2026-04-16：

Kimi 接入已经从“协议不确定、路径不稳定”推进到“协议打通、代码落地、真实联调已跑到三阶段，但完整链路仍受上游时延波动影响，需要继续做降载与超时降级”。
