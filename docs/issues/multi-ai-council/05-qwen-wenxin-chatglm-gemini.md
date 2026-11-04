# Ticket 05: Qwen、Wenxin、ChatGLM 与 Gemini 适配器研发

- **状态**: completed
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
研发通义千问 Qwen (`https://chat.qwen.ai/*`)、文心一言 Wenxin (`https://wenxin.baidu.com/*`)、智谱清言 ChatGLM (`https://chatglm.cn/*`) 以及 Gemini (`https://gemini.google.com/*`) 四大站点的适配器。实现输入框拟人化写入、流式输出监听、四信号完成检测以及思考折叠块动态过滤；在 Background 实现 1.5~3s 错峰激活调度，避免同时并发激活多站触发前端风控；支持在 Side Panel 随时单独开启或关闭任一站点。

**阻塞依赖 (Blocked by):**
- 依赖工单：[04-claude-adapter.md](./04-claude-adapter.md)

**验收准则 (Acceptance criteria):**
- [x] `QwenAdapter`、`WenxinAdapter`、`ChatGLMAdapter`、`GeminiAdapter` 分别接入适配器注册表，支持新建会话与输入提交。
- [x] Qwen 与 ChatGLM 等回复中的深度思考过程被 `stripThinkBlocks` 动态剔除，仅纯净回答回传。
- [x] 针对百度文心一言与 Gemini 的自定义富文本组件成功模拟写入，并稳定完成消息提交流程。
- [x] 多站并发派发时，Background 的 `DispatchHub` 引入 1.5~3 秒随机抖动间隔，平滑依次唤醒与投递。
- [x] Side Panel 的站点开启/关闭列表支持对全部 7 个站点自由开关，并保持选择状态本地记忆。
