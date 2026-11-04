---
name: code-review
description: 对当前分支或工作区改动执行轻量级双轴并行代码评审（本土对齐版）：Standards 轴（核验是否违背 AGENTS.md 规范、受控概念体系与 Fowler 气味基线）与 Spec 轴（核验是否忠实落地 originating Spec/Issue）。直接读取 L1/L2 规范与本地 Spec，无需外部复杂依赖。Use when the user wants a lightweight two-axis code review, reviews a branch/WIP changes, or invokes /code-review.
---

# 双轴并行代码审查 (Code Review — Project Invariants Aligned)

对 `HEAD` 与固定基准点（commit SHA、branch、tag 或 `main`）之间的变动沿两个独立轴线并行审查，防止两轴合流掩盖盲区：
- **Standards（规范轴）**：代码是否符合项目 `AGENTS.md` 底层红线、受控概念规范、路径纪律及经典代码气味基线？
- **Spec（需求轴）**：代码是否忠实实现了关联的 Issue 或本地 L3 技术规格说明书（Spec）？

---

## 执行步骤与核心流程

### 1. 确定对比基准 (Pin the Fixed Point)
- 捕获 diff 命令：`git diff <fixed-point>...HEAD`（三点比较法，对比 merge-base）。
- 确认基准有效且 diff 非空。

### 2. 识别需求与规格源 (Identify Spec Source)
按以下优先级在本地寻址 originating Spec：
1. commit 信息中提及的 Issue 编号（如 `#655`），检查本地 `docs/issues/` 或会话上下文；
2. 用户作为参数传入的 Spec 路径；
3. `docs/specs/` 目录下与当前分支或特性同名的 Markdown 规格说明书；
4. 若均未找到，Spec 轴将报告“无可用 Spec 供比对”。

### 3. 加载 Standards 规范与 smell baseline（规范轴基线）
本仓库 Standards 轴由两部分构成：
- **项目既定底层红线（AGENTS.md & L2 Standards）**：
  - **数据库创世原则**：严禁编写 `ALTER TABLE` 迁移脚本，必须直接修改 `GENESIS_V1_SCHEMA`；本地单一主库 `firefly-ai-folder.db`，严禁业务层寻址 `semantic.raw.db`。
  - **受控概念铁律 (PRD-0058)**：严禁在逻辑判定中出现自然语言词串或 `t()`；严格遵循 $\text{omw.*} \succ \text{hownet.*} \succ \text{builtin.*}$；非视觉介质严禁挂载视觉专有维度。
  - **路径同源与降级纪律**：比较层路径严禁转换 `path.sep`；严禁 `catch` 块静默吞异常返回空集（必须 `logger.warn`）。
  - **注释与构建**：保留既有中文注释；绝对禁止执行 `pnpm format`。
  - **攻防经济学与反过度工程**：严禁脱离实际将单机低价值不可变现代币当金融冷钱包防；严禁假设黑客盲猜 2^256 机器码并冒被抓风险用强实名微信盗号；严禁引入脆弱 PKI/HMAC 导致误杀与客诉；严禁为十万分之一手误在支付到账等核心转化链路强加二次确认弹窗或复杂状态机（偶发手误统一由人工客服后台换绑）。
- **经典代码气味基线（Smell Baseline）**：
  - *Mysterious Name*（命名晦涩）、*Duplicated Code*（重复逻辑）、*Feature Envy*（依恋情结）、*Data Clumps*（数据泥团）、*Primitive Obsession*（基本类型偏执）、*Repeated Switches*（重复分支）、*Shotgun Surgery*（散弹式修改）、*Divergent Change*（发散式变化）、*Speculative Generality*（夸夸其谈未来性）、*Message Chains*（长消息链）、*Middle Man*（中间人）、*Refused Bequest*（被拒绝的遗赠）。

### 4. 派生双轴并行评审 (Parallel Review)
- **Standards 子审视**：对照 AGENTS.md 检查是否存在硬红线违背、受控概念违规或严重代码气味。若 documented repo standards 与 smell baseline 冲突，**documented standards 永远具有最高优先权**。
- **Spec 子审视**：逐条核对代码实现是否漏掉了 Spec 要求的核心流转，或是否存在 Spec 未要求的额外范围膨胀（Scope Creep）。

### 5. 聚合呈现 (Aggregation)
在报告中独立呈现两个章节：
- `## Standards (规范与红线轴)`
- `## Spec (需求实现轴)`
并以简短的一行总结收尾。

---

## 为什么保持双轴独立？
代码完全可以“完美实现需求但严重破坏工程规范”（Spec pass, Standards fail），或者“完全符合代码规范但写错了业务逻辑”（Standards pass, Spec fail）。独立报告可防止一轴掩盖另一轴的严重隐患。
