---
name: to-prd
description: 将当前对话上下文与需求梳理为 PRD 并落盘到本地目录 docs/prd/。遵循 4 环拓扑 L3 规范，严禁上传 GitHub。Use when user wants to create a PRD from current context, says "to-prd", "生成PRD", "编写需求文档", or invokes /to-prd.
---

# To PRD (本地产品需求文档生成器)

将当前会话上下文与代码库理解综合提炼为产品需求文档（PRD），并在本地 `docs/prd/` 目录规范落盘。不打扰用户追问，直接基于已知事实综合成文。

## 本地存储与命名规范 (Directory & Naming)

- **落盘路径**: `docs/prd/<NNNN>-<feature-slug>-prd.md`（如 `docs/prd/0061-feature-name-prd.md`）
- **编号规约**: 检查 `docs/prd/` 下既有最新编号递增，或根据特性命名
- **严禁行为**: **严禁调用 `gh` 上传 GitHub Issues**，**严禁放在 `/docs` 根目录**

## 处理流程 (Process)

1. **代码库与上下文探索**:
   - 梳理已有代码、`CONTEXT.md` 域语言词汇，严格遵循涉及领域的既有 ADR 与 L2 架构规范。

2. **确定测试接缝 (Seams)**:
   - 优先复用既有测试接缝，在最高接入点设计行为测试，与用户简要确认预期。

3. **生成并在本地落盘 PRD**:
   - 使用下方模板撰写 PRD，保存至 `docs/prd/<NNNN>-<feature-slug>-prd.md`。
   - 遵循 4 环拓扑 L3 规范：**强制前 60 行包含 TOC 章节目录速查表**。

4. **图谱挂载与健康度体检**:
   - 文档落盘后，调用 `doc-architect` 流程核验拓扑连接；
   - 运行 `node .agents/skills/doc-architect/scripts/check-doc-health.js` 确保零死链与配额健康。

---

## PRD 标准模板

```markdown
# PRD-<NNNN>: <特性名称>

- **状态**: 草案 / 待审定 (Draft)
- **环级归属**: 第 3 环 (L3 Deep Specs & PRDs)
- **关联上级**: [对应 L2 领域规范路径](../../developer/standards/xxx.md)
- **创建日期**: YYYY-MM-DD

---

## 章节速查导引 (Table of Contents)

| 章节 | 主题 | 概要 | 锚点链接 |
| :--- | :--- | :--- | :--- |
| **§1** | 问题背景 | 用户痛点与当前困境 | [§1 问题背景](#1-问题背景) |
| **§2** | 解决方案 | 核心设计与用户价值 | [§2 解决方案](#2-解决方案) |
| **§3** | 用户故事 | 细化用户场景列表 | [§3 用户故事](#3-用户故事) |
| **§4** | 实现决策 | 模块、契约与架构裁定 | [§4 实现决策](#4-实现决策) |
| **§5** | 测试决策 | 验证方案与外部行为契约 | [§5 测试决策](#5-测试决策) |
| **§6** | 业务价值与转化保护 | 资产价值定位、攻防边界与转化漏斗保护 | [§6 业务价值与转化保护](#6-业务价值与转化保护) |
| **§7** | 范围排除 | 明确 Out of Scope | [§7 范围排除](#7-范围排除) |

---

## 1. 问题背景 (Problem Statement)
从用户视角出发，清晰描述当前面临的痛点与系统缺陷。

## 2. 解决方案 (Solution)
从用户与架构视角，描述预期的解决方案。

## 3. 用户故事 (User Stories)
编号列出详尽的用户故事，格式为：
1. 作为 <角色>，我希望 <功能>，以便于 <价值/收益>

## 4. 实现决策 (Implementation Decisions)
明确记录技术与架构决策：
- 待创建/修改的模块与其核心接口；
- 数据表 Schema 变更（直接修改 Genesis V1 创世，不写 ALTER TABLE）；
- 核心 API 与 IPC 协议；
- *避免包含容易过时的易碎代码片段或临时文件行号*。

## 5. 测试决策 (Testing Decisions)
- 测试原则（仅测外部行为，不测易碎内部实现细节）；
- 涉及测试的模块与已有测试参考用例（Prior Art）。

## 6. 业务价值与转化保护 (Value Proposition & Funnel Safeguards)
- **资产价值定位**：明确功能涉及资产属性（不可提现工具代币，拒绝金融级假想敌防御与沉重 PKI）；
- **核心转化漏斗保护**：确保付费/核心体验秒级到账与即时满足感，严禁为万分之一极端偶发手误强加阻断确认弹窗或复杂状态机；偶发场景走人工客服后台换绑兜底。

## 7. 范围排除 (Out of Scope)
明确本 PRD 不包含的内容，收敛实施边界。

## 8. 后续分解任务 (Planned Slices)
- 计划通过 `/to-issues` 拆分并落盘到 `docs/issues/<feature-slug>/` 的任务清单。
```
