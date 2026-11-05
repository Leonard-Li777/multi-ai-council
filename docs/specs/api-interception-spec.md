# API 旁路拦截流式应答与轻量双轨架构技术规格说明书 (API Stream Interception Spec v2.1)

- **文档状态**: 现行 (Approved - v2.1 收敛终审版)
- **环级归属**: 第 3 环 (L3 Deep Specs & PRDs)
- **关联上级**: [系统架构与工程规范](../developer/standards/architecture.md)
- **版本**: v2.1 (2026-11-05)

---

## 章节速查 (Table of Contents)

| 章节 | 主题 | 概要 | 锚点链接 |
| :--- | :--- | :--- | :--- |
| **§1** | 问题背景与目标 | 核心痛点与工程目标 | [§1 问题背景与目标](#1-问题背景与目标) |
| **§2** | 总体技术方案 | 架构流转、MAIN World嗅探与因果状态机 | [§2 总体技术方案](#2-总体技术方案) |
| **§3** | 接口与数据契约 | 数据结构、IPC 通道定义与厂商数据模型 | [§3 接口与数据契约](#3-接口与数据契约) |
| **§4** | 测试与验证决策 | 测试接缝、覆盖准则与用例 | [§4 测试与验证决策](#4-测试与验证决策) |
| **§5** | 威胁模型与攻防经济学边界 | 资产价值、现实攻击成本与反风控安全合规 | [§5 威胁模型与攻防经济学边界](#5-威胁模型与攻防经济学边界) |
| **§6** | 范围排除 | Out of Scope 边界 | [§6 范围排除](#6-范围排除) |
| **附录** | 历史关联与实施切片 | 关联历史问题与后续切片任务 | [附录 历史关联与实施切片](#附录-历史关联与实施切片) |

---

## 1. 问题背景与目标

### 1.1 核心痛点
当前系统完全依赖基于 DOM 的抓取与监听（`MutationObserver` + `domToMarkdown`），在面对不同站点的复杂前端实现时暴露出以下系统性痛点：
1. **样式与脚本污染**：Google Gemini 的 Angular `<model-response>` 节点内包含数万字符的内联 `<style>` CSS 规则，易穿透至回复正文导致字数虚高；
2. **虚拟滚动卸载**：百度文心一言在长文本时采用虚拟列表优化，视口外上层段落被动态卸载，导致轮询仅抓取到底部最后几个字；
3. **操作按钮遮蔽**：ChatGPT 在回答正文后包含点赞/点踩/复制等带 `data-testid` 的工具栏，DOM 选择器极易误选中末尾按钮导致空文本；
4. **模型切换夺焦**：通义千问等前端下拉框浮层频繁打开会导致输入框失焦阻断提交。

### 1.2 工程目标
确立**“前门叩门，后门收信”双轨融合架构**：
- **前门叩门（输入与触发）**：按宿主环境分流（Textarea 用原生表单 `requestSubmit`，ProseMirror/Quill contenteditable 采用 `execCommand('insertText')` + 点击），由宿主前端合法计算 Cloudflare Turnstile / WASM PoW / Baxia 防爬签名并携带鉴权 Cookie；
- **后门收信（应答捕获）**：通过 WXT 声明的 `world: 'MAIN'` 旁路代理（`window.fetch` 使用 `TransformStream` 原位单管道 + `XMLHttpRequest` 原型代理），在网络层直接接收纯净的 SSE / JSON 数据流，毫秒级推送至 Side Panel；
- **因果状态机（安全兜底）**：一旦网络流握手成功，永久独占接管并冻结 DOM 监听；若网络请求异常（HTTP 4xx/5xx）或长达 15 秒无网络流且 DOM 产生有效节点，无缝平滑回退至 DOM 监听模式，确保系统高可用。

---

## 2. 总体技术方案

### 2.1 端到端架构流程图

```
[Side Panel 调度] 
       │ 
       ▼ (DISPATCH_PROMPT + taskId)
[Content Script (ISOLATED World)] ── 激活监听 ──➔ [WXT MAIN World Stream Sniffer]
       │                                                         │
       ▼ (输入分流: 表单提交 / execCommand)                      ▼ (Proxy fetch & XHR.open/send @ document_start)
[页面原生发起 Fetch / XHR 请求]                           [嗅探到 text/event-stream 或 RPC 响应]
  (自带 Cookie + Turnstile + PoW)                                 │ (TransformStream 原位 pipeThrough / XHR progress)
       │                                                         ▼
       ▼                                                [TextDecoder(stream:true) + LineBuffer + 50ms节流]
[AI 原站前端正常渲染]                                             │
                                                                 ▼ (window.postMessage @ targetOrigin)
                                                [Content Script 接收原始帧流]
                                                                 │ (按站点执行 IncrementalSSE / Snapshot / Delta 解析)
                                                                 ▼ (STREAM_UPDATE)
                                                [Background SW ➜ Side Panel 看板]
```

### 2.2 注入层 (`MAIN` World 透明分流器)
为了兼顾极致稳定与规避网页严格 CSP（如 `script-src 'self'` 禁止 `appendChild` 注入），拦截器完全基于 WXT 原生能力独立构建：

```ts
// entrypoints/interceptor.content/index.ts
export default defineContentScript({
  matches: [
    'https://chatgpt.com/*',
    'https://chat.deepseek.com/*',
    'https://claude.ai/*',
    'https://chat.qwen.ai/*',
    'https://yiyan.baidu.com/*',
    'https://wenxin.baidu.com/*',
    'https://gemini.google.com/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    setupNetworkProxy();
  },
});
```

#### 2.2.1 极简透明分流与防御细则 (<100 行)
`MAIN` 世界脚本遵循**零业务逻辑、单管道原位透传、Fail-Open** 原则：

1. **Proxy 伪装拦截 `window.fetch`**：
   - 使用 `new Proxy(originalFetch, { apply })` 拦截，通过 `Object.defineProperty(window, 'fetch', { value: proxy, ...originalDescriptor })` 保留原生属性描述符，降低风控评分；
2. **`TransformStream` 原位单管道透传（绝不使用 `res.clone()` 或 `tee()`）**：
   - 前置门卫：仅对 `res.body` 存在且未被锁定的目标 API 响应介入；
   - 单管道绑定：`const ts = new TransformStream({ transform(chunk, ctrl) { ... } }); const newRes = new Response(rawBody.pipeThrough(ts), res);`；
   - **属性伪装**：通过 `Object.defineProperty(newRes, 'url', { value: res.url })` 等还原只读属性；
   - **Fail-Open 铁律**：`transform` 内所有旁路逻辑必须 `try...catch`，**异常仅丢弃旁路数据，严禁调用 `ctrl.error()` 击穿宿主请求**；
3. **`XMLHttpRequest` 原型代理（覆盖 Gemini 与降级管线）**：
   - 拦截 `XMLHttpRequest.prototype.open` 与 `send`，使用 `WeakMap<XMLHttpRequest, Context>` 隔离元数据（0 实例污染）；
   - **状态门卫**：严格检查 `this.responseType === '' || this.responseType === 'text'`，防止在二进制类型下读取 `responseText` 引发 `InvalidStateError`；
   - 监听 `progress` 事件增量切片并在 `readyState === 4` 时 flush；
4. **持久化流式解码与 50ms 批量节流**：
   - 持有同一个 `TextDecoder('utf-8')` 实例，每块调用 `decoder.decode(chunk, { stream: true })`，彻底消灭汉字跨包截断导致的 `\uFFFD` 乱码；
   - IPC 广播采用 `50ms` 节流批量聚合，防止高频 Token 触发 IPC 洪水；
5. **安全同源通信与输入校验**：
   - 目标源必须指定为 `window.location.origin`，严禁使用通配符 `'*'`；
   - 隔离层严格校验 `event.source === window`、`streamId` 已注册、`sequence` 单调递增，杜绝跨 iframe 窃听与伪造注入。

### 2.3 调度与输入叩门分流
针对不同站点的前端编辑器架构，采用双轨叩门策略：
- **标准表单类 (`<textarea>`)**：通过原型属性 Setter 同步受控组件状态，优先调用 `input.closest('form')?.requestSubmit()`；
- **富文本类 (`div[contenteditable]`, ProseMirror/Quill)**：
  1. `input.focus()`；
  2. 选区全选：`document.execCommand('selectAll', false)`；
  3. 内核级写入：`document.execCommand('insertText', false, text)`；
  4. 降级构造 `ClipboardEvent('paste')`；
  5. 触发发送按钮点击。

### 2.4 双轨因果状态机与降级设计

```
                    ┌────────────────────────┐
                    │      IDLE (空闲)        │
                    └───────────┬────────────┘
                                │ 发送提示词 (DISPATCH)
                                ▼
                    ┌────────────────────────┐
                    │  PENDING_STREAM (等待) │
                    └─────┬────────────┬─────┘
                          │            │
    捕获到合规 GENERATION 响应流  │            │ 网络请求报错(4xx/5xx) 或 超过 15s TTFT 且 DOM 有输出
                          ▼            ▼
           ┌─────────────────────┐   ┌─────────────────────────┐
           │ STREAMING (独占网络) │   │ DOM_FALLBACK (安全网兜底)│
           │ (永久挂起 DOM 监听)   │   │ (接管并启动 DOM 抓取引擎)  │
           └──────────┬──────────┘   └───────────┬─────────────┘
                      │ 流正常结束 (isDone)        │ 检测到完成信号
                      ▼                          ▼
           ┌───────────────────────────────────────────────────┐
           │        DONE / PARTIAL (用户主动Stop标PARTIAL)       │
           └───────────────────────────────────────────────────┘
```

- **活跃流互斥锁 (Active Stream Lock)**：
  - URL 白名单 + POST 方法 + 请求体主会话特征过滤；
  - 仅标记为 `requestKind === 'GENERATION'` 的流才获准上锁，锁定后忽略后续旁路杂流（如 `/gen_title`）；
  - 无法确定业务归属的流标为 `UNKNOWN`，**绝不猜测篡位**；
- **终止状态分离**：用户中途在网页点击 Stop，宿主 cancel 流时，扩展必须在 100ms 内释放旁路锁，状态标记为 `PARTIAL`，**严禁伪装为 `DONE`**；
- **自愈门禁 (Safe Degradation)**：仅当遭遇网络级故障（HTTP 4xx/5xx）或长达 15 秒（抗高峰期 TTFT 延迟）仍未捕获到任何网络流，且页面 DOM 已经产生有效新增回答节点时，才无缝降级到现有 `QuadSignalDoneDetector` DOM 管线。

---

## 3. 接口与数据契约

### 3.1 跨世界 IPC 通信载荷 (`MAIN` ➔ `ISOLATED`)

```ts
export interface StreamFramePayload {
  streamId: string;
  sequence: number;
  url: string;
  method: 'FETCH' | 'XHR';
  rawText: string;
  isDone: boolean;
  status: 'STREAMING' | 'DONE' | 'PARTIAL' | 'ERROR';
  timestamp: number;
}

export type InterceptorMessage = {
  type: '__MULTI_AI_STREAM_FRAME__';
  payload: StreamFramePayload;
};
```

### 3.2 各厂商协议解析与数据语义规范 (ISOLATED 适配层)

| 站点 | 核心 API 路径特征 | 传输协议 | 数据模型 | 解析处理规范 |
| :--- | :--- | :--- | :--- | :--- |
| **ChatGPT** | `/backend-api/conversation` | SSE (`text/event-stream`) | **Snapshot 与 Delta 双模兼容** | ① 若含 `message.content.parts`：全量快照直接覆盖，严禁 `+=`；<br>② 若含 `event: delta` 及 `{p, o, v}`：按 JSON Pointer 增量累加；<br>③ 过滤非 assistant 节点；遇到 `[DONE]` 结束。 |
| **DeepSeek** | `/api/v0/chat/completion` | SSE (`text/event-stream`) | **Delta (增量切片)** | 1. 深度思考阶段：提取 `delta.reasoning_content`，派发思考心跳，防止系统误判超时；<br>2. 回复生成阶段：提取 `delta.content`，累加至当前缓冲区；遇到 `finish_reason` 标记完成。 |
| **Claude** | `/api/organizations/.*/completion` | SSE (`text/event-stream`) | **Delta (增量切片)** | 提取 `content_block_delta.delta.text`，累加到正文；遇到 `message_stop` 或 `[DONE]` 标记完成。 |
| **Qwen** | `/api/` 且包含 `chat` | SSE (`text/event-stream`) | **Delta (增量切片)** | 提取 `output.text` 或 `delta.content`，按累加模型维护；遇到流终止完成。 |
| **Wenxin** | `/eb/chat/conversation` | Chunked JSON Stream | **Snapshot / Delta 混合** | 识别返回的 `result` 字段，维护去重累加缓冲区；遇到 `is_end: true` 标记完成。 |
| **Gemini** | `StreamGenerate` 或 `assistant.lamda` | Batchexecute RPC 文本流 (XHR/Fetch) | **RPC 嵌套数组解包** | 采用“长度提示 + 括号配对”分块解包；剔除 `)]}'\n`；优先定位 `wrb.fr` 内层文本块；未命中按**排除用户 prompt 回显的首选候选节点**降级。 |

### 3.3 轻量独立 `IncrementalSSEParser` 规范
在 ISOLATED 层维护独立的轻量分帧器（约 70 行）：
- 统一规范切分 `\r\n`、`\n` 与 `\r`；
- 以连续换行（空行）作为事件分界线；
- 支持一个事件包含多行 `data:` 的自动 `\n` 拼接；
- 正确识别并过滤注释行（以 `:` 开头）、`event:`、`id:` 与 `[DONE]` 终止符；
- 流结束 (EOF) 时，未完成的残帧依据情况标记 `PARTIAL` 或丢弃，杜绝截断 JSON 抛错。

---

## 4. 测试与验证决策

### 4.1 测试接缝 (Test Seams)
- **协议解析器纯函数接缝**：将 `IncrementalSSEParser`、Gemini RPC 括号配对解包器、ChatGPT 双模解析器提取为无 DOM 依赖纯函数，进行毫秒级单元测试；
- **Fetch/XHR 模拟接缝**：通过 Mock TransformStream 和 Mock XHR 验证 `Fail-Open`、`url` 属性伪装及 `progress` 切片。

### 4.2 验收断言准则
- [ ] **AC1 (WXT 合规构建)**：拦截器完全通过 WXT `defineContentScript({ world: 'MAIN' })` 声明编译，在严格 CSP 站点控制台 0 报 CSP 错误。
- [ ] **AC2 (多字节 UTF-8 零乱码)**：单元测试验证将汉字（如 `“你好，世界！多模型终审”`）按奇数字节跨包切分时，解码输出 100% 保持原字符，0 出现 `\uFFFD` 乱码。
- [ ] **AC3 (SSE Line Buffer 零丢包)**：单元测试验证在包含 `\r\n`、多 `data:` 行及任意切断时，`IncrementalSSEParser` 完整解析，0 抛出 JSON Parse 语法异常。
- [ ] **AC4 (DeepSeek 思考与回复管道分离)**：DeepSeek R1 模式下，思考过程作为 reasoning 流式通知保活，正文作为独立内容推送，无超时误杀。
- [ ] **AC5 (网络/DOM 独占性与平滑降级)**：网络捕获正常时，DOM 监听器完全处于休眠状态；模拟网络未命中时，系统在 15 秒内平滑激活 DOM 兜底，任务无死锁。
- [ ] **AC6 (用户主动 Stop 同步释放)**：网页端点击 Stop 终止生成后，扩展侧旁路流在 100ms 内释放并标记 `PARTIAL`，无挂起悬挂请求。
- [ ] **AC7 (杂项后台流 0 覆盖)**：在主回复流期间并发产生 `/gen_title` 请求时，互斥锁与路由过滤器确保主回复内容 0 污染、0 覆盖。
- [ ] **AC8 (XHR 代理全通)**：模拟 XHR `progress` 增量推送时，数据无阻断被捕获，并在 `arraybuffer` 等非文本类型下安全跳过 0 抛异常。
- [ ] **AC9 (SW 30s 回收幂等恢复)**：在流式生成期间触发 Service Worker 挂起与重启，Side Panel 内容无重复追加、无状态倒退。
- [ ] **AC10 (代码规范与类型全绿)**：`tsc --noEmit` 0 错误，所有新增测试及历史 23 项测试全绿，打包体积增量不超过 15KB。

---

## 5. 威胁模型与攻防经济学边界

### 5.1 资产价值属性
本项目为本地个人桌面端 Chrome 扩展，操作对象为用户本人浏览器中的合法登录会话。数据留存于本地 `IndexedDB` 与 `session` 存储，不存在云端多租户数据泄露资产风险。严禁过度设计重型加密通道。

### 5.2 现实风控对抗与防封号边界
各大商业 AI 模型（OpenAI、DeepSeek、阿里、Google）花费高额成本部署了动态客户端防护（WASM PoW、Cloudflare Turnstile、Baxia 设备指纹）。
- **攻防不对称性**：从扩展层逆向破解 WASM PoW 或伪造 Cloudflare 签名属于极高成本且易遭封号的不稳定行为；
- **合规边界**：本方案严格限定为“**前门叩门，后门收信**”，由宿主网页合法计算并发出请求，扩展只在本地旁路分流只读响应。既规避了封号风险，又达成了 0 破解成本与最大稳健性。

### 5.3 跨源广播泄露防护
严格封堵 `window.postMessage` 向外广播风险，`targetOrigin` 必须限定为 `window.location.origin`，严禁使用通配符 `'*'`，防止内嵌第三方脚本窃听 LLM 回复。

---

## 6. 范围排除
1. **脱机脱离浏览器直接调用官方付费 API**：不涉及用户自行填入 OpenAI / Anthropic 商业 API Key 的直连模式（保持 Web 会话协作定位）；
2. **主动篡改出站请求 Body**：不修改网页发出的请求载荷（如强制篡改模型参数），仅做被动旁路拦截（Passive Sniffing）；
3. **自动化破解人机验证码**：遇 Cloudflare Turnstile 或滑块验证码一律提示用户手动通过，绝不引入打码平台或暴力破解；
4. **常驻 CDP 调试器**：不将 `chrome.debugger` 作为生产运行模式（仅保留用于本地排障与极端诊断的实验性备选通道）。

---

## 附录 历史关联与实施切片

- **前序问题排查与复盘**: [系统架构与工程规范](../developer/standards/architecture.md)
- **待分解执行切片**:
  - **Slice 1 (网络捕获内核与输入叩门)**：WXT `MAIN` World Proxy Fetch/XHR 基础框架、`TransformStream` 原位单管道、`simulateTextInput` 叩门强化与 UTF-8 流解码单元测试；
  - **Slice 2 (协议解析器与因果状态机)**：`IncrementalSSEParser`、ChatGPT 双模解析器、DeepSeek R1 思考流管道与 Active Stream Lock 互斥状态机；
  - **Slice 3 (Gemini RPC 解包与全站端到端回归)**：Gemini 括号配对解包器、XHR 增量流合流、AC1~AC10 自动化回归测试。
