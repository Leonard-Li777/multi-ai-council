---
name: retro
description: 会话技术复盘与 4 环知识图谱回流专家。在经历复杂 Bug 排障、多轮对抗审查修复（plan-loop/implement-loop）或重大架构重构后，提炼踩坑教训、反直觉陷阱与工具链改进点，按标准模板落盘至 L4 (docs/retro/YYYY-MM-DD-*.md)，并驱动向 L3/L2/L1 及 doc-radar.js 的知识升维回流与原文档就地纠偏。Use when user asks for a retrospective, says "retro", "复盘", "总结踩坑经验", or invokes /retro.
---

# 会话技术复盘与知识升维回流 (Retro & Knowledge Reflow)

针对当前或指定的开发/排障会话进行深度工程复盘。**复盘的终极目的不是写一篇流水账日志，而是修改环境、纠偏原文档、升级规则，让未来的 Agent 永远不再踩同一个坑。**

## 核心执行流程 (Execution Workflow)

```
[复杂排障 / 多轮审查循环 / 特性收口]
       │
       ▼
1. 根因与偏差审计 ── 盘点会话中的曲折点：用户纠偏、多次失败的尝试、被盲审抓出的漏网之鱼
       │
       ▼
2. 原文档就地纠偏 ── 若被现有 L2/L3 文档误导 ➔ 立即直接编辑原文档修正错误/补齐边界 (绝不只记在日志里)
       │
       ▼
3. 落盘 L4 复盘档 ── 生成 `docs/retro/YYYY-MM-DD-<topic-slug>.md`，向上单级关联所属 L3/L2
       │
       ▼
4. 知识升维与工具进化 ── 提炼新不变量至 L2「心智胶囊」/ L1 红线 / `doc-radar.js` 触发词
       │
       ▼
5. 目录刷新与健康门禁 ── 运行 `pnpm run docs:toc` + `check-doc-health.js` 确保零死链与零跨环穿透
```

## 执行步骤

### 1. 五维深度审计 (5-D Session Audit)
回顾当前会话轨迹，重点挖掘以下 5 类高价值资产：
1. **认知偏差与文档误导 (Doc Misdirection)**：Agent 走弯路是否因为某篇既有 L2/L3 文档描述过时、概念模糊或遗漏了前提？
2. **反直觉技术陷阱 (Counter-Intuitive Gotchas)**：Windows 平台特性、Electron 跨进程 IPC、SQLite 锁机制、Rust FFI 或受控概念映射中有哪些违背直觉的坑？
3. **导航与检索摩擦 (Navigation Friction)**：Agent 在开始时是否漏读了某篇关键规范？是否应该在源码头部加 `@doc-anchor` 或在 `doc-radar.js` 中补充触发关键词？
4. **审查与测试漏网之鱼 (Review & Test Gaps)**：为什么某个 Bug 直到第 2/3 轮审查或集成阶段才暴露？是否需要转化为自动化单测或写入 L2 审查规则？
5. **领域术语结晶 (Domain Vocabulary)**：是否涌现了新的业务概念或废弃了旧概念？（若有，联动 `/domain-modeling` 更新 `CONTEXT.md` 或 `docs/adr/`）。

### 2. 先行执行「原文档就地手术」(In-place Source Doc Surgery)
- **铁律**：凡发现既有 L2 规范（`docs/developer/...`）或 L3 规格（`docs/specs/...`）存在错误或歧义，**必须先使用文件编辑工具直接去原文档原地修改正确**，绝不允许让带病文档继续留在库中误导后续会话。
- 若提炼出极具价值的领域级防坑正反例（`❌ vs ✅`），直接补入对应 L2 文档开篇的 **「30 行业务心智模型胶囊」** 中。

### 3. 落盘 L4 标准复盘文档 (Write L4 Retro File)
在 `docs/retro/` 目录下创建 `YYYY-MM-DD-<topic-slug>.md`（严格遵循 4 环拓扑：L4 仅允许向上单级链接至 L3 或 L2，**严禁在复盘文档中反向链接 L1 `AGENTS.md`**，反之亦严禁在 `AGENTS.md` 中直接挂载 L4 复盘）：

```markdown
# [Retro] <复盘主题名称> 技术复盘与知识沉淀

- **日期**: YYYY-MM-DD
- **环级归属**: 第 4 环 (L4 Context & History)
- **关联上级**: [对应 L3 Spec 或 L2 规范标题](../specs/xxx-spec.md)

---

## 1. 任务背景与核心症结 (Context & Root Cause)
- **现象与目标**: [简述任务或故障现象]
- **根本原因 (Root Cause)**: [一针见血指出物理/架构层面的真实根因]

## 2. 踩坑记录与反直觉陷阱 (Gotchas & Counter-Intuitive Lessons)
### 陷阱 1：<陷阱简述>
- **错误假设**: [当时为什么会想错]
- **客观事实**: [真实运行机制是什么]
- **代码正反例**:
  - ❌ **错误写法**: `...`
  - ✅ **正确写法**: `...`

## 3. 向上回流与环境进化账本 (Knowledge Reflow Ledger)
- **原文档就地勘误**: 已修正 [`<文档名>`](../developer/standards/xxx.md) 第 X 节关于 xxx 的定义。
- **L2 心智胶囊/规范升级**: 已将 xxx 不变量合入 [`<L2 文档名>`](../developer/standards/xxx.md)。
- **雷达与锚点加固**: 已在 `<源码文件>` 顶部注入 `@doc-anchor`，并在 `doc-radar.js` 补充关键词 `<kw>`。
- **测试防线加固**: 新增单测 `<test-file-path>` 永久锁死该回归路径。
```

### 4. 挂载指针与门禁校验 (Linkage & Health Gate)
1. 在该复盘所支撑的 L3 Spec（文末「附录：历史关联与复盘」章节）或对应 L2 文档中，添加指向本篇 L4 复盘的单级引用链接。
2. 若本次修改了任何 L2/L3 文档的章节标题，运行 `pnpm run docs:toc` 刷新目录导航。
3. 运行确定性拓扑健康度检查，确保 0 死链、0 死锚、0 跨环穿透：
   ```bash
   node .agents/skills/doc-architect/scripts/check-doc-health.js
   ```
