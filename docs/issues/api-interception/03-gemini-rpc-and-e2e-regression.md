# Ticket 03: Gemini RPC 嵌套解包与全站端到端回归验收

- **状态**: completed
- **类型**: AFK
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [API 旁路拦截流式应答与轻量双轨架构技术规格说明书](../../specs/api-interception-spec.md)

## 交付目标 (What to build)

完成 Google Gemini 特殊协议解包、postMessage 硬核防欺骗安全验证与全系统端到端回归验收：
1. **Gemini Batchexecute RPC 文本流解包器**：
   - 剥离头部安全防护前缀 `)]}'\\n`；
   - 基于"长度提示 + 括号配对"算法安全切分块与 JSON 嵌套数组，杜绝贪婪正则带来的 ReDoS 与截断抛错；
   - **三级回退阶梯**：
     - ① 优先提取 `inner[4][0][1][0]` 核心正文槽位；
     - ② 若 Google 前端键位漂移，遍历提取**非用户当前 Prompt 回显且长度 >= 1 的有效候选文本**；
     - ③ 极端残损或无法解包时，标记 `PARTIAL` 兜底，绝不抛出未捕获异常；
2. **Gemini 大增量单帧阈值实测与动态校准**：
   - 实测/压测 Gemini RPC 单帧报文尺寸；若发现单帧超过 Ticket 01 的默认 4MB 或特定阈值，动态适配分片机制或将单帧阈值提升至实测峰值的 2 倍，确保正文不因阈值限制被误丢；
3. **postMessage 伪造与安全硬防御 (AC10b 端到端)**：
   - 在 `ISOLATED` 监听入口与 Background 链路实施端到端拦截：网页伪造同源消息下 `ProviderRun` 状态 0 污染、0 异常推进；
4. **SW 30s 回收幂等与全站集成回归**：
   - 验证 Service Worker 30 秒失活重启后从 `chrome.storage.session` + IndexedDB 恢复时，旁路流状态机无重复追加与状态倒退；
   - 运行项目全量回归测试套件。

## 阻塞依赖 (Blocked by)

- 依赖前置切片：[02-protocol-parsers-and-state-machine.md](./02-protocol-parsers-and-state-machine.md)

## 验收准则 (Acceptance criteria)

- [x] **AC-GEMINI (Gemini RPC 解包与三级回退)**：8 个单测覆盖三级阶梯（inner[4][0][1][0] 优先路径、键位漂移候选回退、极端破损 Fail-Open）、序列化 JSON 字符串嵌套解包、50ms 合并复合分块、多 `wrb.fr` 条目检索，0 抛错，100% 通过。
- [x] **AC-FRAME-LIMIT (单帧阈值实测与 Gemini 不丢帧)**：`MAX_STREAM_FRAME_SIZE` 实测校准为 8MB（峰值 × 2）；2.4MB 合法长文本帧通过门卫，10MB 攻击帧被拦截丢弃，正文 0 丢失。
- [x] **AC9 (SW 30s 回收幂等恢复)**：`restoreSession()` 实现状态机幂等重水化，重水化后调用 `handleStreamFrame` 追加后续增量，断言 `'前半部分后半部分'` 通过，终态 `DONE`，无重复、无倒退。
- [x] **AC10b (端到端 postMessage 伪造注入防御)**：
  - 网页注入伪造同源 `postMessage`（伪造未注册 `streamId` 的 `isDone: true`、超大 10MB rawText）时，扩展拒绝该帧且状态机不推进，`ProviderRun` 数据 0 污染；
  - 针对已处于终端态（`DONE` / `PARTIAL`）的 `streamId`，后续延迟到来的流式帧 100% 丢弃，0 状态污染。3 个端到端测试全部通过。
- [x] **AC-ALL-GREEN (代码规范与全绿门禁)**：`tsc --noEmit` 0 错误，21 文件 88 测试 100% 通过，所有 Ticket 03 新增代码已通过 Round 2 盲审 CLEAN PASS（D1~D4 修复已验证）。
