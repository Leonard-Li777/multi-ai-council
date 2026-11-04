# Ticket 02: Quorum 降级调度与一键跳过机制

- **状态**: completed
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)

**交付目标 (What to build):**
打破“必须全 Done 才终审”的死锁风险。实现 Quorum 决策机制（设置最少完成站点数，如 3 家）与截止时间保护；在 Side Panel 为处于卡顿、人机验证或错误状态的站点提供“跳过此站点”交互，将其标记为 `CANCELED` 或 `PARTIAL`；当已完成站点数满足 Quorum 条件时，激活“快速降级终审 (FastForward)”能力，允许对已就绪的 N 方结果提前发起终审。

**阻塞依赖 (Blocked by):**
- 依赖工单：[01-multi-turn-and-conversation-ref.md](./01-multi-turn-and-conversation-ref.md)

**验收准则 (Acceptance criteria):**
- [x] 当某站点卡在 `WAITING_READY` 或 `BLOCKED_CAPTCHA` 时，状态卡片显示“跳过”按钮。
- [x] 点击“跳过”后，该站点状态幂等流转为 `CANCELED`，释放调度等待，并在持久化数据中记录跳过原因。
- [x] 当完成站点数达到 `minCompletedProviders` 设定值，底部 Quorum 降级按钮解除禁用并高亮可点击。
- [x] 设定 90 秒超时计时器，超时后自动弹窗提示用户是否立即对已就绪站点发起终审，杜绝无限期挂起。
