---
name: to-tickets
description: 将规划方案、Spec 或对话拆解为一组带依赖阻塞关系的细粒度工单并落盘到 docs/issues/<feature-slug>/。遵循 4 环拓扑 L4 规范，严禁上传 GitHub。Use when user wants to break down work into local ticket files, declares blocking edges, or invokes /to-tickets.
disable-model-invocation: true
---

# To Tickets (本地工单切片生成器)

将规划方案、技术规格（Spec）或会话讨论拆解为一组**细粒度工单（Tickets）**。每个工单是一条独立的垂直切片，明确声明阻塞它的前置工单（`Blocked by`），并在本地 `docs/issues/<feature-slug>/` 独立落盘。

## 本地存储与目录规范 (Directory & Naming)

- **落盘目录**: `docs/issues/<feature-slug>/`
- **文件命名**: `<NN>-<slug>.md`（从 `01` 开始顺序编号，如 `01-schema-and-dao.md`, `02-pipeline.md`）
- **单工单单文件**: 坚决一工单对应一独立文件，严禁合并为单个大文件
- **严禁行为**: **严禁调用 `gh` 上传 GitHub Issues**，**严禁放在 `/docs` 根目录**

## 处理流程 (Process)

### 1. 收集上下文
- 读取对话或指定的本地 Spec / PRD / Issue 路径。

### 2. 探索代码库与前置重构 (Prefactoring)
- 探索既有代码边界，优先寻找重构机会（"先让改动变容易，再做容易的改动"）。
- **宽泛重构原则 (Expand–Contract)**：若改动牵扯面广（如重命名列、修改泛型），不得强行塞进单一切片；按**展开-收缩**三步拆解：
  1. Expand：增加新形式与旧形式共存；
  2. Migrate：分批次迁移调用方，各批次作为独立工单；
  3. Contract：调用方全部迁移完毕后，在终尾工单删除旧形式。

### 3. 规划切片与依赖边 (Draft Slices & Blocking Edges)
- 每个切片垂直切穿所有集成层，尺寸适合单次上下文会话；
- 赋予每个工单精确的前置依赖列表（`Blocked by`）。

### 4. 向用户核对
呈现编号工单列表（包含标题、阻塞前置、交付价值），根据用户反馈调整粒度与依赖。

### 5. 在本地落盘工单文件
在 `docs/issues/<feature-slug>/` 目录下，按依赖拓扑顺序（前置优先）创建各工单文件：

```markdown
# Ticket <NN>: <工单标题>

- **状态**: ready-for-agent
- **环级归属**: 第 4 环 (L4 Context & History)
- **父级目标**: [对应本地需求](../../prd/xxx-prd.md 或 ../../specs/xxx-spec.md)

**交付目标 (What to build):**
从系统行为视角描述本工单实现的端到端行为，避免堆砌易碎代码。

**阻塞依赖 (Blocked by):**
- 依赖工单：[01-xxx.md](./01-xxx.md)
(若无前置依赖，则填写："无 - 处于工作前沿 (Frontier)")

**验收准则 (Acceptance criteria):**
- [ ] 验收点 1
- [ ] 验收点 2
```

### 6. 工作前沿推进 (Frontier)
告知用户当前前置依赖全部满足的 **Frontier 工单**（可立即唤醒智能体开工执行的工单）。
