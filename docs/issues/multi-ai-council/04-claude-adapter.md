# Ticket 04: Claude 站点适配器研发

- **状态**: completed
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
实现 Claude (`https://claude.ai/*`) 适配器与 Content Script。攻坚其独有的 contenteditable 交互输入层与反风控机制；实现会话检测、未登录/Cloudflare 拦截感知、四信号完成检测及 Markdown 抓取；打通 Background 对 Claude 标签页的调度与归组。

**阻塞依赖 (Blocked by):**
- 依赖工单：[03-chatgpt-adapter.md](./03-chatgpt-adapter.md)

**验收准则 (Acceptance criteria):**
- [x] `ClaudeAdapter` 实现标准适配器契约，支持 ProseMirror/Lexical 输入框注入。
- [x] 准确识别 Claude 的登录失效与 Cloudflare 验证码页面，向 Side Panel 上报 `BLOCKED_LOGIN` 或 `BLOCKED_CAPTCHA`。
- [x] 成功触发发送并验证消息进入会话流，支持流式内容向 Side Panel 实时回显。
- [x] 页面回复结束后在 ≤3 秒内触发 `DONE`，无丢字或早停误判。
- [x] WXT manifest `host_permissions` 新增 `https://claude.ai/*`。
