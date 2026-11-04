# Ticket 01: 会话状态机强化与多轮上下文延伸联动

- **状态**: completed
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
打通多轮会话状态持久化与延伸判定的端到端联动。将各站点的远端会话 URL/ID 固化记录到 `ProviderRun.conversationRef` 中；当识别为“延续会话”时，复用该标签页保持同一会话上下文发送；当识别为“新会话”或用户手动点击“切换为新建”时，自动触发站点的 `createNewChat()` 并更新会话引用；确保在标签页重载或 Side Panel 重新开启后仍能精准恢复会话映射。

**阻塞依赖 (Blocked by):**
- 无 - 处于工作前沿 (Frontier)

**验收准则 (Acceptance criteria):**
- [x] 第一轮任务完成后，DeepSeek 的实际 URL（含会话 hash/ID）被准确存入 `ProviderConversationRef` 并持久化到 IndexedDB。
- [x] 第二轮输入“继续优化上述代码”，规则引力集判定为延续，Background 沿用既有 DeepSeek 标签页而不触发新会话导航。
- [x] 用户在 Side Panel 点击“切换为新建”，触发 DeepSeek 适配器 `createNewChat()`，成功开启新会话并将新 URL 存入状态机。
- [x] 关闭 Side Panel 并重新打开，输入框上方会话映射栏仍准确显示当前绑定的上一轮会话标题与 URL。
