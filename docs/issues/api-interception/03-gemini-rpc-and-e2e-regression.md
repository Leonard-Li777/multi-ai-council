# Ticket 03: Gemini RPC 嵌套解包与全站端到端回归验收

- **状态**: ready-for-agent
- **类型**: AFK
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [API 旁路拦截流式应答与轻量双轨架构技术规格说明书](../../specs/api-interception-spec.md)

## 交付目标 (What to build)

完成 Google Gemini 特殊协议解包、postMessage 硬核防欺骗安全验证与全系统端到端回归验收：
1. **Gemini Batchexecute RPC 文本流解包器**：
   - 剥离头部安全防护前缀 `)]}'\n`；
   - 基于“长度提示 + 括号配对”算法安全切分块与 JSON 嵌套数组，杜绝贪婪正则带来的 ReDoS 与截断抛错；
   - **三级回退阶梯**：
     - ① 优先提取 `inner[4][0][1][0]` 核心正文槽位；
     - ② 若 Google 前端键位漂移，遍历提取**非用户当前 Prompt 回显且长度 >= 1 的有效候选文本**；
     - ③ 极端残损或无法解包时，标记 `PARTIAL` 兜底，绝不抛出未捕获异常；
2. **Gemini 大增量单帧阈值校准**：
   - 实测/压测 Gemini RPC 单帧报文尺寸；若发现单帧超过 1MB，动态适配分片机制或将单帧阈值提升至实测峰值的 2 倍，确保正文不因阈值限制被误丢；
3. **postMessage 伪造与安全硬防御 (AC10)**：
   - 在 `ISOLATED` 监听入口实施白名单源校验、单帧上限校验、终端态硬锁（已 `DONE/PARTIAL` 的 stream 拒收后续增量）、未注册 streamId 的直接 `isDone` 虚构握手拦截；
4. **SW 30s 回收幂等与全站集成回归**：
   - 验证 Service Worker 30 秒失活重启后从 `chrome.storage.session` + IndexedDB 恢复时，旁路流状态机无重复追加与状态倒退；
   - 运行项目全量回归测试套件。

## 阻塞依赖 (Blocked by)

- 依赖前置切片：[02-protocol-parsers-and-state-machine.md](./02-protocol-parsers-and-state-machine.md)

## 验收准则 (Acceptance criteria)

- [ ] **AC-GEMINI (Gemini RPC 解包与三级回退)**：提供真实 Gemini RPC 样本（含长文本及跨包切片），解包器 100% 正确剥离样式与系统元数据，提取出纯净 Markdown，0 抛错；在键位微调时二级候选回退生效。
- [ ] **AC-FRAME-LIMIT (单帧阈值与 Gemini 不丢帧)**：对 Gemini 大报文进行极限压测，单帧若超 1MB 自动安全分片或自适应阈值放行，正文 0 丢失。
- [ ] **AC9 (SW 30s 回收幂等恢复)**：在流式生成过程中触发 Background Service Worker 挂起与重启，Side Panel 流式渲染无跳动、无重复段落、终态一致。
- [ ] **AC10 (postMessage 伪造硬防御)**：
  - 网页注入伪造同源 `postMessage`（伪造未注册 `streamId` 的 `isDone: true`、超大 2MB rawText）时，扩展拒绝该帧且状态机不推进；
  - 针对已处于终端态（`DONE` / `PARTIAL`）的 `streamId`，后续延迟到来的流式帧 100% 丢弃，0 状态污染。
- [ ] **AC-ALL-GREEN (代码规范与全绿门禁)**：`tsc --noEmit` 0 错误，单元测试通过率 100%，打包体积增量不超过 15KB。
