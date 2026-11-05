# Ticket 02: 协议解析器矩阵与因果双轨状态机

- **状态**: ready-for-agent
- **类型**: AFK
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [API 旁路拦截流式应答与轻量双轨架构技术规格说明书](../../specs/api-interception-spec.md)

## 交付目标 (What to build)

在 `ISOLATED` World 与数据处理层构建轻量协议解析器矩阵与双轨因果状态机：
1. **轻量独立 `IncrementalSSEParser` (~70行纯函数)**：规范支持 `\r\n` / `\n` / `\r` 换行分帧，多 `data:` 行自动 `\n` 拼接，过滤注释 `:` 与非 data 行，精准识别 `[DONE]` 终止符；
2. **ChatGPT 双模解析器**：全量快照（`message.content.parts` 全量覆盖）与 Delta Encoding（`event: delta` 及 `{p, o, v}` 按 JSON Pointer 增量拼装）双模自适应；
3. **DeepSeek R1 深度思考流管道**：分离提取 `delta.reasoning_content`（派发思考心跳/保活通知）与 `delta.content`（正文流式缓冲区），正文启动时思考流平滑沉淀；
4. **Claude / Qwen / Wenxin 协议适配**：Claude `content_block_delta`、Qwen `output.text`/`delta.content`、文心一言 `result` 去重累加；
5. **`UNKNOWN` 流隔离隔离原则**：非主会话或无法确信归属的流标为 `UNKNOWN`，**只记录调试日志，绝不汇总到 `responseSnapshot` 或终审报告输入**；
6. **双轨因果状态机 (Active Stream Lock)**：
   - 捕获到合规 `GENERATION` 流立即上锁，永久挂起 DOM 监听；
   - 遭遇 HTTP 4xx/5xx 或等待超过 15 秒且 DOM 产生有效节点，无缝平滑回退至既有 DOM 监听引擎；
   - Stop 中止 100ms 内释放旁路锁，状态标记为 `PARTIAL`。

## 阻塞依赖 (Blocked by)

- 依赖前置切片：[01-network-proxy-kernel.md](./01-network-proxy-kernel.md)

## 验收准则 (Acceptance criteria)

- [ ] **AC3 (SSE Line Buffer 零丢包)**：单元测试验证跨 chunk 随机切断的 multi-line `data:` SSE 流，`IncrementalSSEParser` 100% 正确复原事件，0 抛出 JSON 语法错误。
- [ ] **AC4 (DeepSeek 思考与正文管道分离)**：DeepSeek R1 模式下，思考内容作为 reasoning 专属心跳通知，正文为独立流，Side Panel 正确分层呈现，无超时误报。
- [ ] **AC5 (网络/DOM 独占与平滑降级)**：网络拦截正常时 DOM 监听器 0 消耗休眠；模拟网络流未命中时，系统在 15 秒超时后激活 DOM 兜底，任务正常完成。
- [ ] **AC6 (用户主动 Stop 状态标记)**：模拟宿主 cancel 流时，状态机立即在 100ms 内记录 `status: 'PARTIAL'` 并释放锁，严禁混入 `DONE` 状态。
- [ ] **AC7 (后台杂流 0 覆盖与 UNKNOWN 隔离)**：主生成期间并发收到 `/gen_title` 或 `UNKNOWN` 后台请求时，主会话缓冲区 0 污染、0 覆盖，UNKNOWN 流仅记录日志不汇总。
