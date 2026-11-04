# Ticket 06: Model A~E 匿名化打乱与 DeepSeek 终审聚合链路

- **状态**: ready-for-agent
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
打通多模型协同闭环的最高价值环节：自动汇总就绪的 N 方回答，执行 `Model A~E` 随机乱序匿名化，抹除品牌锚定与 DeepSeek 的自我偏好；拼接带有 Prompt Injection 隔离沙箱与四层结构要求（共识观点、分歧辨析、聚类排布、待验证项）的终审 Meta-Prompt；自动唤起 DeepSeek 的全新会话标签页，自动投递并监听最终综合回复生成，流式抓取回传。

**阻塞依赖 (Blocked by):**
- 依赖工单：[02-quorum-and-skip-fallback.md](./02-quorum-and-skip-fallback.md)
- 依赖工单：[05-qwen-wenxin-chatglm-gemini.md](./05-qwen-wenxin-chatglm-gemini.md)

**验收准则 (Acceptance criteria):**
- [ ] 5 方（或 Quorum 满足的 N 方）全部就绪后，自动触发终审流水线。
- [ ] 建立双向匿名映射字典（如 `Model A -> Claude`, `Model B -> DeepSeek`），原始回答内站点名均被脱敏替换。
- [ ] Meta-Prompt 包含明确的数据沙箱包裹符与防 Prompt Injection 约束声明。
- [ ] 自动在 Tab Group 中打开新的 DeepSeek 独立标签页，自动输入并提交聚合任务。
- [ ] 终审生成内容流式回传至 Side Panel，最终结果完整落盘至 IndexedDB 的 `synthesisRun` 字段。
