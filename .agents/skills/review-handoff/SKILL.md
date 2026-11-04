---
name: review-handoff
description: 在 AI 完成编码后生成审查上下文或第三方 Review 提示词。支持两种正交模式：(1) --blind 对内子 Agent 零偏见盲审包（剥离辩护、注入冻结账本、引导升维思考、限 3000 字符防崩溃）；(2) --external 对外移交提示词（供人类或外部 LLM 一键复制，含三轨制审查与升维替代方案探讨槽位）。无需重复提取 diff，直接调取会话记忆与 doc-radar 契约。Use when generating review context for implement-loop subagents or external reviewers, says "生成 review 提示词", "打包 review 上下文", "探讨更优方案", or invokes /review-handoff.
---

# 移交代码审查 (Review Handoff — 双模正交版)

利用当前会话已有的开发记忆与 `doc-radar.js` 扫描出的领域契约，**禁止耗费额外算力重复跑 git diff 分析**，按场景输出对应的审查数据包，兼顾微观代码事实严审与宏观升维更优范式探讨。

## 双工作模式 (Dual Modes)

| 模式 | 触发场景 | 核心设计原则 | 字数配额 |
| :--- | :--- | :--- | :--- |
| **`--blind` (对内盲审包)** | `implement-loop` 内部派生子 Agent 审查时默认使用 | **零作者辩护偏差 + 升维探索**：只给客观需求边界、改动文件清单、系统硬契约、冻结账本与升维探讨指引。**严禁解释“为什么这么写/为什么妥协”**，迫使子 Agent 独立从代码事实挑刺并审视全局范式。 | **$\le 3,000$ 字符**<br>(避开 OCR 8000 字符崩溃红线) |
| **`--external` (对外移交包)** | 用户要求“生成提示词给外部 Review / 一键复制”时使用 | **上下文充沛完备 + 三轨制审查**：包含完整八大模块（含核心设计折中、已否决备选方案、导览清单及升维更优方案专用槽位），使用四反引号包裹供一键复制。 | 无硬性限制 |

## 执行步骤

### 1. 记忆调取与契约锚定 (Zero-Diff Context Sourcing)
- 直接从会话记忆提取本次修改的文件列表、关联的 Issue/Spec 路径（`docs/specs/...`）与核心功能边界。
- 提取 `AGENTS.md` 九大底层红线及 `doc-radar.js` 命中的 L2 领域不变量。

### 2. 按模式组装输出

#### 模式 A：`--blind` 对内子 Agent 盲审包模板（紧凑无辩护版）
```markdown
## [BLIND-REVIEW-PACKET] 内部独立盲审约束包 (Round N)

### 1. 权威需求源头与必读规范 (先读前 60 行 TOC)
- **关联 Spec / Issue**: `<docs/specs/xxx-spec.md>`
- **必读领域规范 (L2)**: `<docs/developer/standards/xxx.md>`

### 2. 范围边界 (Scope Boundary)
- **In-Scope (本次必达目标)**:
  - [客观目标 1]
  - [客观目标 2]
- **Explicit Non-Goals (明确不做，严禁在此方向加戏)**:
  - [非目标 1]

### 3. 一票否决级系统硬契约 (System Invariants)
- **数据库**: 直接改 `GENESIS_V1_SCHEMA`，严禁 `ALTER TABLE` 迁移；单一主库，严禁业务层引用 `semantic.raw.db`。
- **受控概念 (PRD-0058)**: 严禁自然语言字符串或 `t()` 参与逻辑判定；严守 `omw.* > hownet.* > builtin.*`；非视觉介质严禁挂载视觉维度。
- **可观测与路径**: 严禁 `catch` 块静默吞异常返回空集（须 `logger.warn`）；路径比较层严禁转换 `path.sep`；保留有效中文注释。
- **攻防经济学与转化漏斗底线**: 严禁脱离实际将单机低价值不可变现代币当金融冷钱包防（2^256 机器码盲猜为 0，强实名微信追责威慑现实）；严禁引入脆弱 PKI/HMAC 导致误杀客诉；严禁为十万分之一偶发手误在核心支付到账链路强加阻断确认弹窗与复杂状态机（偶发走人工客服后台换绑）。

### 4. 待审文件清单 (Target Files)
- `<path/to/file1.ts>`
- `<path/to/file2.ts>`

### 5. 防振荡冻结账本 (Frozen Oscillation Ledger — 严禁反向提议)
- [若为第 1 轮填“无”；若为第 2+ 轮，列出前序轮次经 `review-vet` 裁定冻结的位置与结论，禁止子 Agent 要求改回旧形态]

### 6. 审查深度与升维探讨指令 (Review Mandate)
- **主线事实查验**: 严查物理可行性、边界异常与硬契约，严禁脑补加戏。
- **升维更优解探索**: 严禁仅作局部“行级校对员”！若站到更高架构维度发现根本性更优范式（复杂度骤降/从根源消灭问题），务必专门输出【升维更优方案探讨】。
```

#### 模式 B：`--external` 对外第三方完整移交模板
（遵循 [REFERENCE.md](REFERENCE.md) 八大完整模块，使用四反引号 ````markdown ... ```` 包裹输出，方便用户一键复制。）
