---
name: implement
description: 基于既定 Spec、Issue 或任务指令执行高水准 TDD 编码实现（本土契约对齐版）。强制前置运行 doc-radar.js 对齐领域心智模型，严守受控概念、Genesis V1 单库与路径同源铁律，完成代码编写、类型检查与单元/集成测试验证。注意：本技能仅负责编码与测试全绿，不主动执行 git commit，以便无缝衔接下游审查循环。Use when implementing features/fixes directly or invoked as Step 2 inside /implement-loop.
---

# 核心功能编码与验证执行器 (Implement — Project Invariants Aligned)

基于已明确的 Spec、Issue 切片或用户指令，遵循测试驱动开发（TDD）与仓库底层红线完成高质量代码实现。

## 执行步骤 (Execution Pipeline)

### 1. 知识雷达预检与接缝锚定 (Radar Pre-flight & Seams)
1. **强制运行知识雷达**：
   ```bash
   node .agents/skills/doc-architect/scripts/doc-radar.js <目标文件或任务关键词>
   ```
   按需切片读取命中的 L2 规范（先读前 60 行 TOC + 30 行业务心智胶囊），100% 确认业务不变量。
2. **查阅单例字典**：若涉及后端 Runtime Service 交互，先查阅 [`public-services-catalog.md`](../../docs/developer/references/public-services-catalog.md)，优先复用既有服务接缝，严禁重复造轮子。

### 2. 严守系统硬性编码铁律 (Coding Redlines)
在编写每一行 TypeScript / Rust / SQL 代码时，强制执行以下自检：
- **数据库创世原则**：Schema 变更直接修改 `GENESIS_V1_SCHEMA`（`database.ts`），**严禁编写 `ALTER TABLE` 迁移脚本**；严禁业务代码引用 `semantic.raw.db`。
- **受控概念铁律 (PRD-0058)**：
  - 遵循 `Ingress 归一化为 code ➔ Processing 纯枚举/code 运算 ➔ Egress 反查展示名`；
  - 严守 $\text{omw.*} \succ \text{hownet.*} \succ \text{builtin.*}$，严禁私造 `builtin.*` 替代已有权威码；
  - **严禁在逻辑判定中使用自然语言词串（如 `'设计稿'`）或 `t()`**，哨兵值统一使用 `SENTINEL_NAMES`。
- **路径同源纪律**：比较层（`isPathEqual` / `isSubPath` / SQL `WHERE path`）保持原生 `path.sep`，**严禁将 `\` 转为 `/`**。
- **降级可观测与防腐**：任何检索候选源或外部调用的 `try/catch` 降级必须调用 `logger.warn` 记录原因，**严禁静默吞异常返回空集**；承担能力补位的函数**严禁命名为 `legacy*`**。
- **注释与格式化禁令**：保留所有有效既有中文注释；新增核心模块鼓励在文件顶部标注 `// @doc-anchor: docs/specs/xxx-spec.md#锚点`；**绝对禁止执行 `pnpm format`**。

### 3. TDD 编码与验证门禁 (TDD & Verification Gates)
1. **测试先行/同步编写**：遵循 [`testing-guide.md`](../../docs/developer/standards/testing-guide.md) 规范（Desktop 注意 Electron ABI 匹配，Omni Rust 遵守隔离编译五铁律与热缓存池规范）。
2. **高频增量验证**：
   - 运行目标包的类型检查（如 `pnpm --filter @firefly/desktop typecheck`）；
   - 定向运行本次新增与关联的单元测试文件，确保 100% 通过且无回归破坏。

### 4. 干净交接 (Handoff Boundary)
- **保持工作区未提交状态**：完成编码与测试全绿后，**不要自行执行 `git commit` 或调用 `/code-review`**，保持改动留在工作区（Working Tree），直接将控制权交还给上层调度器（如 `/implement-loop` 的 `ocr` 盲审循环，或等待用户下一步指令）。
