---
name: to-issues
description: 将方案、Spec 或 PRD 拆分为独立的垂直切片（Tracer Bullet）任务并落盘到本地目录 docs/issues/<feature-slug>/。遵循 4 环拓扑 L4 规范，严禁上传 GitHub。Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues, says "to-issues", "拆解任务", "生成issues", or invokes /to-issues.
---

# To Issues (本地垂直切片工单生成器)

将规划方案、技术规格（Spec）或需求文档（PRD）拆解为一组**独立可领取的垂直切片工单（Tracer Bullet Issues）**，并在本地 `docs/issues/<feature-slug>/` 目录规范落盘。

每个工单是一条端到端打通所有集成层（Schema、核心逻辑、UI/导出、测试）的细长垂直切片，坚决杜绝按单层横向切割。

## 本地存储与目录规范 (Directory & Naming)

- **落盘目录**: `docs/issues/<feature-slug>/`
- **文件命名**: `<NN>-<slice-slug>.md`（按依赖拓扑从 `01` 开始顺序编号，如 `01-schema-and-db.md`, `02-omni-core-rule.md`, `03-ui-and-e2e.md`）
- **特性总览**: 可选创建 `00-overview.md` 列出全景依赖图
- **严禁行为**: **严禁调用 `gh` 上传 GitHub Issues**，**严禁放在 `/docs` 根目录**

## 处理流程 (Process)

### 1. 收集上下文
- 读取当前会话已有事实；若用户传入了本地文件路径（如某 PRD 或 Spec 路径），直接读取其全文及验收准则。

### 2. 探索代码库 (可选)
- 了解当前代码实际接入点，工单标题与内容必须使用项目受控域语言与 ADR 决策。

### 3. 设计垂直切片 (Tracer Bullets)
- 拆解为端到端可验证的切片，每个切片尺寸适合单个新鲜上下文窗口；
- 标注类型：`AFK`（智能体可全自动自闭环实现）或 `HITL`（需人工参与架构仲裁/设计评审），尽可能优先追求 AFK。
- 声明阻塞依赖关系（`Blocked by`）。

### 4. 向用户核对
向用户呈现编号切片清单，包含：
- **标题**: 简短明确的动作名称
- **类型**: AFK / HITL
- **阻塞前置 (Blocked by)**: 必须先完成的切片编号/名称
- **关联父文档**: 指向对应的本地 `docs/prd/xxx.md` 或 `docs/specs/xxx.md`
- 询问用户粒度与依赖是否合理，根据反馈迭代。

### 5. 在本地落盘工单文件
用户确认后，按依赖顺序在 `docs/issues/<feature-slug>/` 下为每个切片写入独立的 Markdown 文件。

---

## 本地工单标准模板

```markdown
# Issue <NN>: <切片标题>

- **状态**: ready-for-agent
- **类型**: AFK / HITL
- **环级归属**: 第 4 环 (L4 Context & History)

## 关联父需求 (Parent)
- 本任务隶属于本地需求文档：[对应本地 PRD 或 Spec](../../prd/xxx-prd.md)

## 本切片目标 (What to build)
从用户与端到端系统行为视角，描述本切片实现的完整流转，而非单层堆砌代码。

## 验收准则 (Acceptance criteria)
- [ ] 验收准则 1：数据层/核心逻辑端到端连通
- [ ] 验收准则 2：异常分支处理与测试用例通过
- [ ] 验收准则 3：运行 lint 与健康度检查无破坏

## 阻塞依赖 (Blocked by)
- 依赖前置切片：[01-xxx.md](./01-xxx.md)
(若无前置依赖，则填写："无 - 可立即开工 (Frontier)")
```
