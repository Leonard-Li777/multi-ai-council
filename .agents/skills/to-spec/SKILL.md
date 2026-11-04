---
name: to-spec
description: 将当前对话上下文与技术方案综合为深度规格书（Spec）并落盘到本地目录 docs/specs/。遵循 4 环拓扑 L3 规范，严禁上传 GitHub。Use when user wants to create a spec from current context, says "to-spec", "生成Spec", "编写技术规格书", or invokes /to-spec.
---

# To Spec (本地技术规格说明书生成器)

将当前会话讨论的技术方案与代码库事实综合为深度技术规格说明书（Technical Spec），并在本地 `docs/specs/` 目录规范落盘。不打扰用户追问，直接基于已知事实综合成文。

## 本地存储与命名规范 (Directory & Naming)

- **落盘路径**: `docs/specs/<feature-slug>-spec.md`（如 `docs/specs/tag-admissibility-filter-spec.md`）
- **命名规约**: 小写短横线命名，以 `-spec.md` 结尾
- **严禁行为**: **严禁调用 `gh` 上传 GitHub Issues**，**严禁放在 `/docs` 根目录**

## 处理流程 (Process)

1. **代码库与上下文探索**:
   - 梳理既有代码事实、`CONTEXT.md` 域语言词汇，严格遵循涉及领域的既有 ADR 与 L2 架构规范。

2. **确定测试接缝与边界 (Seams)**:
   - 尽量复用最高层级的既有测试接缝，最小化接入点。

3. **生成并在本地落盘 Spec**:
   - 使用下方模板撰写 Spec，保存至 `docs/specs/<feature-slug>-spec.md`。
   - 遵循 4 环拓扑 L3 规范：**强制前 60 行包含 TOC 章节目录速查表**；
   - 明确向上声明归属的 L2 领域 Hub。

4. **图谱挂载与健康度体检**:
   - 在所属的 L2 领域规范文件（如 `docs/developer/standards/xxx.md`）中登记本 Spec 指针；
   - 运行 `node .agents/skills/doc-architect/scripts/check-doc-health.js` 确保零死链与配额健康。

---

## Spec 标准模板

```markdown
# <特性名称> 技术规格说明书 (<Feature Name> Spec)

- **文档状态**: 现行 / 待审定 (Draft / Approved)
- **环级归属**: 第 3 环 (L3 Deep Specs & PRDs)
- **关联上级**: [对应 L2 领域规范路径](../../developer/standards/xxx.md)
- **版本**: v1.0 (YYYY-MM-DD)

---

## 章节速查导引 (Table of Contents)

| 章节 | 主题 | 概要 | 锚点链接 |
| :--- | :--- | :--- | :--- |
| **§1** | 问题背景与目标 | 核心痛点与工程目标 | [§1 问题背景与目标](#1-问题背景与目标) |
| **§2** | 总体技术方案 | 架构流转与核心契约 | [§2 总体技术方案](#2-总体技术方案) |
| **§3** | 接口与数据契约 | 数据结构、DB/RPC/IPC 定义 | [§3 接口与数据契约](#3-接口与数据契约) |
| **§4** | 测试与验证决策 | 测试接缝、覆盖准则与用例 | [§4 测试与验证决策](#4-测试与验证决策) |
| **§5** | 威胁模型与攻防经济学边界 | 资产价值、现实攻击成本与转化漏斗保护 | [§5 威胁模型与攻防经济学边界](#5-威胁模型与攻防经济学边界) |
| **§6** | 范围排除 | Out of Scope 边界 | [§6 范围排除](#6-范围排除) |
| **附录** | 历史关联与实施切片 | 关联的 L4 Issues / 复盘 | [附录 历史关联与实施切片](#附录-历史关联与实施切片) |

---

## 1. 问题背景与目标 (Problem & Goals)
清晰阐述要解决的核心工程痛点、技术瓶颈或功能演进诉求。

## 2. 总体技术方案 (Solution Architecture)
描述端到端数据流转、进程组件职责边界、状态机流转等核心设计。

## 3. 接口与数据契约 (Interface & Data Contracts)
- 数据模型与 SQLite / 云端 Schema 变更（直接修改 Genesis V1）；
- 函数签名、RPC 接口与 IPC 通道定义；
- 强类型枚举与常量常量字典（禁止自然语言判定）；
- *避免包含过时易碎的实现细节代码片段或文件行号*。

## 4. 测试与验证决策 (Testing Decisions)
- 测试接缝说明；
- 行为验证策略（单元测试、集成测试、端到端测试用例）；
- 兼容性与边界场景验证。

## 5. 威胁模型与攻防经济学边界 (Threat Model & Attack Economics)
- **资产价值属性**：定性与定量说明被保护对象的经济价值（如单机几十元不可提现工具代币，严禁套用金融级零信任与重型 PKI）；
- **现实算力与法律成本**：明确攻击者所面临的现实物理/算力空间（如 64 位 SHA256 机器码碰撞为 0）与强实名制法律风险；
- **核心转化漏斗保护**：明确保留即时到账体验，严禁为万分之一极端偶发手误强加阻断确认弹窗或复杂状态机；偶发场景明确交由人工客服后台换绑兜底。

## 6. 范围排除 (Out of Scope)
明确不包含的技术实现内容。

## 附录：历史关联与实施切片
- 关联的前序探索/复盘：[L4 历史文档](../../archive/xxx.md)
- 拆分的执行切片：`docs/issues/<feature-slug>/` 下的独立子任务
```
