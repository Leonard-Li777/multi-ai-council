# Ticket 04: 网络层拦截集成至适配器双轨融合

- **状态**: completed
- **类型**: AFK
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [API 旁路拦截流式应答与轻量双轨架构技术规格说明书](../../specs/api-interception-spec.md)

## 交付目标 (What to build)

将 Ticket 01~03 实现的网络层拦截能力（`StreamOrchestrator` + `UnifiedSemanticStreamParser` + `StreamFrameValidator`）集成到 Multi-AI Council 现有的站点适配器（Content Script ISOLATED World），实现真正的"前门叩门，后门收信"双轨融合：

1. **`lib/interceptor/network-listener.ts`** — ISOLATED World postMessage 接收器：
   - 监听 `__MULTI_AI_STREAM_FRAME__` 消息（来自 MAIN World `BatchedFrameDispatcher`）
   - 经 `StreamFrameValidator` 门禁校验后路由到 `StreamOrchestrator`
   - `dispatchPrompt()` 由 `DISPATCH_PROMPT` 消息触发
   - 幂等初始化 + `destroy()` 生命周期管理

2. **`lib/interceptor/adapter-bridge.ts`** — 语义事件 → PortMessage 适配层：
   - 将 `StreamOrchestrator` `onSnapshotUpdate` / `onStateChange` 翻译为 `STREAM_UPDATE` / `STATUS_CHANGE`
   - `stripThinkBlocks` 对 snapshot 做清洗
   - 暴露 `createAdapterBridge(siteName, jobId, sendFn, url)` 工厂函数

3. **修改各 Content Script** — 双轨模式替换：
   - 在 `DISPATCH_PROMPT` 处理中，`sendPrompt()` 成功后优先启动网络监听（`NetworkListener.dispatchPrompt`）
   - `StreamOrchestrator` 触发 `DOM_FALLBACK` 时激活原 `listenGeneration()` DOM 路径
   - 对全部 7 个 Content Script 生效（ChatGPT、DeepSeek、Claude、Qwen、Wenxin、ChatGLM、Gemini）

## 阻塞依赖 (Blocked by)

- 依赖：[03-gemini-rpc-and-e2e-regression.md](./03-gemini-rpc-and-e2e-regression.md) ✅ completed

## 验收准则 (Acceptance criteria)

- [x] **AC-NL1 (NetworkListener 单测)**：postMessage 帧经校验后正确路由到 `StreamOrchestrator`；无效帧（未注册 streamId、超限、终端态后）被拒绝，状态机不推进。已在 `tests/network-listener.test.ts` (5 tests) 验证。
- [x] **AC-NL2 (AdapterBridge 单测)**：`StreamOrchestrator` SNAPSHOT 事件 → `STREAM_UPDATE`（`isFinished: false`）；DONE 事件 → `STREAM_UPDATE`（`isFinished: true`）+ `STATUS_CHANGE`（`status: 'DONE'`）；PARTIAL → `STATUS_CHANGE`（`status: 'PARTIAL'`）。已在 `tests/adapter-bridge.test.ts` (4 tests) 验证。
- [x] **AC-NL3 (双轨切换)**：`StreamOrchestrator` 状态进入 `DOM_FALLBACK` 时，DOM `listenGeneration` 被激活；网络层正常时，DOM 路径不运行。已在全部 7 个 Content Script 中落地集成。
- [x] **AC-ALL-GREEN**：`tsc --noEmit` 0 错误，全量 23 个测试套件 97 项测试 100% 全绿，打包成功。
