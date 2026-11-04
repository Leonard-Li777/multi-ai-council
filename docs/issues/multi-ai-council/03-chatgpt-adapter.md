# Ticket 03: ChatGPT 站点适配器研发

- **状态**: ready-for-agent
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
实现 ChatGPT (`https://chatgpt.com/*`) 的完整适配器与 Content Script。攻坚基于 ProseMirror 的受控富文本输入框（`div#prompt-textarea`），通过剪贴板模拟注入协议触发 React/ProseMirror 状态更新并解除发送按钮禁用；实现流式监听、四信号完成判定与 Markdown 结构提取；配置 manifest 权限与 Background 调度路由。

**阻塞依赖 (Blocked by):**
- 依赖工单：[01-multi-turn-and-conversation-ref.md](./01-multi-turn-and-conversation-ref.md)

**验收准则 (Acceptance criteria):**
- [ ] `ChatGPTAdapter` 实现 `AISiteAdapter` 标准契约（含多级选择器降级）。
- [ ] 成功向 `div#prompt-textarea` 注入文本并触发提交，发送按钮由禁用成功变为可用并被触发。
- [ ] 流式过程中实时回传回答快照至 Side Panel，正确监听停止生成按钮与完成状态。
- [ ] 回复内容通过 `domToMarkdown` 提取，代码块、语法高亮类名和排版无损保留。
- [ ] WXT manifest `host_permissions` 与 content_scripts 新增 `https://chatgpt.com/*`。
