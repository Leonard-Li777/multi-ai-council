# Ticket 01: MAIN World 网络代理内核与输入叩门增强

- **状态**: ready-for-agent
- **类型**: AFK
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [API 旁路拦截流式应答与轻量双轨架构技术规格说明书](../../specs/api-interception-spec.md)

## 交付目标 (What to build)

构建 WXT `world: 'MAIN'` 运行环境下的高保真透明网络拦截器与输入叩门增强模块：
1. **Proxy 拦截 `window.fetch`**：使用 `new Proxy(originalFetch, { apply })` 并通过 `Object.defineProperty` 保留原生属性描述符；请求体提取遵循 Best-Effort 原则（不消费原 Request body，不可读降级 `UNKNOWN`，0 抛错阻断原请求）；
2. **`TransformStream` 原位单管道透传**：`rawBody.pipeThrough(ts)` 替换 `clone()/tee()`；显式实现 `transform` (透传 + Fail-Open 旁路)、`flush` (EOF 标记) 与 `cancel(reason)`（用户 Stop/页面 cancel 时清空 buffer、标记 `status: 'PARTIAL', isDone: true, endReason: 'PAGE_ABORT'` 并释放旁路锁）；
3. **`XMLHttpRequest` 原型代理**：拦截 `open` 与 `send`，使用 `WeakMap` 隔离元数据；`responseType === '' || responseType === 'text'` 安全门卫；挂载 `progress` + `readystatechange(3/4)` 双保险监听；统一经 `flushDelta()` + `offset` 指针幂等切片；
4. **UTF-8 流式持久化解码与 50ms 节流**：持有单例 `TextDecoder('utf-8')` 并使用 `{ stream: true }` 防多字节汉字截断乱码；50ms 节流 IPC 批量广播；
5. **跨世界 IPC 契约强化与常量配置**：
   - 在 `StreamFramePayload` 增加 `endReason: 'EOF' | 'PAGE_ABORT' | 'OBSERVER_ABORT' | 'PARSER_ERROR'`；下游 Reducer 只认 `status` (`STREAMING` | `DONE` | `PARTIAL` | `ERROR`)，`isDone` 仅指示物理流终止；
   - 定义可配置单帧上限常量 `MAX_STREAM_FRAME_SIZE = 4 * 1024 * 1024` (默认 4MB，Ticket 03 实测后校准为峰值 × 2)；
6. **富文本输入叩门分流**：强化 `simulateTextInput`（textarea 调用原型 Setter + `closest('form')?.requestSubmit()`；contenteditable 采用 `focus` + `selectAll` + `insertText` + 回退 `paste` 事件）。

## 阻塞依赖 (Blocked by)

- 无 - 处于工作前沿 (Frontier)

## 验收准则 (Acceptance criteria)

- [ ] **AC1 (WXT 合规构建)**：`entrypoints/interceptor.content/index.ts` 声明为 `world: 'MAIN', runAt: 'document_start'`，编译打包后在严格 CSP 站点 0 报错。
- [ ] **AC2 (多字节 UTF-8 零乱码)**：单元测试验证汉字字符串跨包任意奇数字节拆分输入，持久化 TextDecoder 解码输出 100% 保持原字符，0 出现 `\uFFFD`。
- [ ] **AC8 (XHR 双事件全通与防御)**：模拟 XHR 流式响应，`progress` 与 `readystatechange` 协同切片 0 漏帧；在 `arraybuffer` 等非文本类型下安全跳过 0 抛异常。
- [ ] **AC-PERF (XHR 切片性能基准)**：针对 50 万字符 XHR 流式响应，`flushDelta()` 累计切片耗时 < 200ms（或相对耗时不超过原生 `responseText` 属性读取耗时的 2 倍），游标切片不得因长文本阻塞主线程超过 50ms。
- [ ] **AC-SEMANTICS (`endReason` 与 `status` 语义解耦)**：网页 cancel 时派发 `status: 'PARTIAL', isDone: true, endReason: 'PAGE_ABORT'`；下游测试验证状态机准确判定为未完成中止，绝不误判为 `DONE`。
- [ ] **AC-INPUT (输入叩门无损)**：textarea 与 ProseMirror/Quill 富文本测试中，文本 100% 正确填入并触发提交，且不触发原页面输入校验报错。
- [ ] **AC10a (管道层 postMessage 硬防御单测)**：
  - 拒绝未注册 `streamId` 的直接 `isDone: true` 虚构握手；
  - 针对已处于终端态（`DONE` / `PARTIAL` / `ERROR`）的 `streamId`，后续延迟到来的流式增量帧 100% 丢弃；
  - 超过 `MAX_STREAM_FRAME_SIZE` 的异常帧直接拦截丢弃；
  - `sequence` 非单调递增帧直接丢弃。
