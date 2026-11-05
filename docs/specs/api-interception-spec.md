# API 旁路拦截流式应答与轻量双轨架构技术规格说明书 (API Stream Interception Spec)

- **文档状态**: 现行 (Approved)
- **环级归属**: 第 3 环 (L3 Deep Specs & PRDs)
- **关联上级**: [系统架构与工程规范](../developer/standards/architecture.md)
- **版本**: v1.0 (2026-11-05)

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
- **前门叩门（输入与触发）**：由页面原生表单管线（`input.closest('form')?.requestSubmit()` + 受控原型注入）合法触发，网页自身计算 Cloudflare Turnstile / WASM PoW / Baxia 防爬签名并携带鉴权 Cookie；
- **后门收信（应答捕获）**：通过 WXT 声明的 `world: 'MAIN'` 旁路代理（`response.clone()`），在网络层直接接收纯净的 SSE / JSON 数据流，毫秒级推送至 Side Panel；
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
       ▼ (模拟文字输入 + form.requestSubmit)                     ▼ (Monkey-patch window.fetch @ document_start)
[页面原生发起 Fetch 请求]                                 [嗅探到 text/event-stream 或 RPC 响应]
  (自带 Cookie + Turnstile + PoW)                                 │ (微任务同步 response.clone())
       │                                                         ▼
       ▼                                                [TextDecoder(stream:true) + LineBuffer]
[AI 原站前端正常渲染]                                             │
                                                                 ▼ (window.postMessage @ targetOrigin)
                                                [Content Script 接收原始帧流]
                                                                 │ (按站点执行 Snapshot / Delta 解析)
                                                                 ▼ (STREAM_UPDATE)
                                                [Background SW ➜ Side Panel 看板]
```

### 2.2 注入层 (`MAIN` World 透明分流器)
为了兼顾极致稳定与规避网页严格 CSP（如 `script-src 'self'` 禁止 `appendChild` 注入），拦截器完全基于 WXT 的原生能力独立构建：

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
    setupFetchProxy();
  },
});
```

#### 极简透明分流原则
`MAIN` 世界脚本遵循**零业务逻辑、极简透明分流**原则（代码量控制在 100 行内），不解析复杂的站点专有业务，仅负责：
1. **微任务同步克隆（防 Stream Lock）**：在 `window.fetch` 返回的微任务首顺位立即执行 `const clone = response.clone();`，防止原网页先获取锁导致 `TypeError: Response body is already locked`；
2. **持久化流式解码（防 UTF-8 汉字截断）**：持有同一个 `const decoder = new TextDecoder('utf-8');` 实例，每块调用 `decoder.decode(chunk, { stream: true })`，彻底消灭跨数据包多字节汉字截断导致的 `\uFFFD` 碎裂乱码；
3. **行缓冲处理（Line Buffer）**：按 `\n` 切分 SSE 帧，未闭合的残帧暂存缓冲区，杜绝因数据帧切分导致 `JSON.parse` 抛出语法异常；
4. **生命周期防御（防内存泄漏）**：使用 `try ... finally` 确保在流关闭或异常中断时，强制调用 `reader.cancel().catch(() => {})` 与 `reader.releaseLock()`；
5. **安全同源通信**：使用 `window.postMessage({ type: '__MULTI_AI_STREAM_FRAME__', payload: { streamId, rawText, isDone, status } }, window.location.origin)`，严禁使用通配符 `'*'`。

### 2.3 双轨因果状态机与降级设计

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
    捕获到首个合规 API 响应流 │            │ 网络请求报错(4xx/5xx) 或 超过 15s TTFT 且 DOM 有输出
                          ▼            ▼
           ┌─────────────────────┐   ┌─────────────────────────┐
           │ STREAMING (独占网络) │   │ DOM_FALLBACK (安全网兜底)│
           │ (永久挂起 DOM 监听)   │   │ (接管并启动 DOM 抓取引擎)  │
           └──────────┬──────────┘   └───────────┬─────────────┘
                      │ 流正常结束 (isDone)        │ 检测到完成信号
                      ▼                          ▼
           ┌───────────────────────────────────────────────────┐
           │                   DONE (完成落地)                  │
           └───────────────────────────────────────────────────┘
```

- **独占原则 (Mutual Exclusion)**：一旦收到第一帧 API 流数据，立即进入 `STREAMING` 独占模式，**彻底解绑并销毁 DOM 监听器**，100% 杜绝网络流与 DOM 抓取之间的覆盖打架；
- **自愈门禁 (Safe Degradation)**：仅当遭遇网络级故障（HTTP 4xx/5xx）或长达 15 秒（抗高峰期 TTFT 延迟）仍未捕获到任何网络流，且页面 DOM 已经产生有效新增回答节点时，才无缝降级到现有 `QuadSignalDoneDetector` DOM 管线。

---

## 3. 接口与数据契约

### 3.1 跨世界 IPC 通信载荷 (`MAIN` ➔ `ISOLATED`)

```ts
export interface StreamFramePayload {
  streamId: string;
  url: string;
  method: string;
  rawText: string;
  isDone: boolean;
  status: number;
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
| **ChatGPT** | `/backend-api/conversation` | SSE (`text/event-stream`) | **Snapshot (全量快照)** | 每帧直接读取 `parts[0]`，其本身为累加后的全量文本，**直接作为 snapshot 广播，严禁 `+=` 拼接**；遇到 `[DONE]` 结束。 |
| **DeepSeek** | `/api/v0/chat/completion` | SSE (`text/event-stream`) | **Delta (增量切片)** | 1. 深度思考阶段：提取 `delta.reasoning_content`，派发思考心跳，防止系统误判超时；<br>2. 回复生成阶段：提取 `delta.content`，累加至当前缓冲区；遇到 `finish_reason` 标记完成。 |
| **Claude** | `/api/organizations/.*/completion` | SSE (`text/event-stream`) | **Delta (增量切片)** | 提取 `content_block_delta.delta.text`，累加到正文；遇到 `message_stop` 或 `[DONE]` 标记完成。 |
| **Qwen** | `/api/` 且包含 `chat` | SSE (`text/event-stream`) | **Delta (增量切片)** | 提取 `output.text` 或 `delta.content`，按累加模型维护；遇到流终止完成。 |
| **Wenxin** | `/eb/chat/conversation` | Chunked JSON Stream | **Snapshot / Delta 混合** | 识别返回的 `result` 字段，维护去重累加缓冲区；遇到 `is_end: true` 标记完成。 |
| **Gemini** | `StreamGenerate` 或 `assistant.lamda` | Batchexecute RPC 文本流 | **RPC 嵌套数组解包** | 剔除防 XSS 前缀（如 `)]}'\n`），解包外层长度前缀数组，提取 `wrb.fr` 内层文本块。 |

---

## 4. 测试与验证决策

### 4.1 测试接缝 (Test Seams)
- **协议解析器纯函数接缝**：将 SSE 拆包、Line Buffer 重组、各厂商 JSON/RPC 解包逻辑提取为纯函数（如 `parseSseFrame(line: string)`、`decodeUtf8Stream(chunks: Uint8Array[])`），完全脱离 Chrome 运行时进行极速单元测试；
- **Fetch 代理模拟接缝**：使用 Mock Response 与 Mock ReadableStream 验证 `response.clone()`、`reader.cancel()` 与跨帧切分。

### 4.2 验收与行为准则
- [ ] **AC1 (WXT 合规构建)**：拦截器完全通过 WXT `defineContentScript({ world: 'MAIN' })` 声明编译，在启用严格 CSP 的 ChatGPT/Gemini/Claude 站点控制台 0 报 CSP 错误。
- [ ] **AC2 (多字节 UTF-8 零乱码)**：具备自动化单元测试，模拟将包含中文字符的汉字（如 `“你好，世界！多模型终审”`）按奇数字节切分为跨 Chunk 流时，解码输出 100% 保持原字符，0 出现 `\uFFFD` 乱码。
- [ ] **AC3 (SSE Line Buffer 零丢包)**：单元测试验证将 `data: {"content": "Hello"}\n\ndata: {"content": " World"}\n\n` 切断为任意碎片字节包时，解析器 100% 完整重组，0 抛出 JSON Parse 语法异常。
- [ ] **AC4 (DeepSeek 思考与回复管道分离)**：DeepSeek R1 模式下，思考过程作为 reasoning 流式通知保活，正文作为独立内容推送，无 3 秒超时熔断误杀。
- [ ] **AC5 (网络/DOM 独占性与平滑降级)**：网络捕获正常时，DOM 监听器完全处于休眠状态；模拟网络未命中时，系统在 15 秒内平滑激活 DOM 兜底，任务无死锁。
- [ ] **AC6 (代码规范与类型全绿)**：`tsc --noEmit` 0 错误，所有新增测试及历史 23 项测试全绿，打包体积增量不超过 15KB。

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
3. **自动化破解人机验证码**：遇 Cloudflare Turnstile 或滑块验证码一律提示用户手动通过，绝不引入打码平台或暴力破解。

---

## 附录 历史关联与实施切片

- **前序问题排查与复盘**: [系统架构与工程规范](../developer/standards/architecture.md)
- **待分解执行切片**：
  - Slice 1: WXT `world: 'MAIN'` 拦截器基础框架与 UTF-8 流解码单元测试
  - Slice 2: ChatGPT / DeepSeek SSE 协议解析器与因果状态机
  - Slice 3: Gemini RPC 批处理数组解包与多站点端到端回归
