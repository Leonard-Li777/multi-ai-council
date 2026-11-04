# Ticket 07: 终审报告可视化、历史归档与脱敏导出

- **状态**: completed
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
在 Side Panel 呈现最终的终审报告与溯源视图。支持渲染经过 DOMPurify 清洗的高质量 Markdown 终审报告；提供“揭晓模型映射”开关，将 `Model A~E` 还原为具体站点；提供一键复制 Markdown 成果与导出 JSON 快照功能；构建历史任务抽屉（History Drawer），支持翻阅与重载过去存储在 IndexedDB 中的协同审核记录。

**阻塞依赖 (Blocked by):**
- 依赖工单：[06-anonymized-synthesis-deepseek.md](./06-anonymized-synthesis-deepseek.md)

**验收准则 (Acceptance criteria):**
- [x] Side Panel 顶部/底部可切换展示终审报告，Markdown 样式美观并彻底过滤潜在恶意 XSS。
- [x] 支持点击“查看模型真身”，直观高亮展示每个观点的真实来源模型。
- [x] 提供“一键复制定稿”与“导出脱敏数据 (JSON/MD)”按钮，并弹出复制成功气泡反馈。
- [x] 历史记录抽屉可列出最近 20 轮任务，点击任意历史任务可完整回显其 5 方原文与终审提炼结果。
- [x] 提供“清空历史”危险操作二次确认与彻底清理逻辑。
