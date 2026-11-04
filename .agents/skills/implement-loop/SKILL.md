---
name: implement-loop
description: 自闭环智能编码与自动审查修复流水线（v2.0 确定性增强版）。先激活 caveman 极简模式并运行 doc-radar.js 预加载必读领域心智模型，完成 TDD 初始编码后，驱动「review-handoff(--blind 零偏见盲审包) -> 子 Agent 运行 open-code-review-delegate -> 主 Agent 运行 review-vet 去伪存真并更新防振荡账本 -> 修复与回归验证」，直至 0 缺陷收敛并执行知识回流自检与原子提交。Use when user wants automated implementation with iterative review-and-fix loops, says "implement-loop", "自闭环编码", "多轮自动review修复", or invokes /implement-loop.
---

# 自闭环编码与多轮审查修复 (Implement Loop v2.0)

以确定性知识雷达预热 + 零作者偏见对抗盲审 + 显式防振荡状态账本，驱动从编码到 0 缺陷交付的全自动闭环。

## 核心流程

```
[任务需求 / Spec / Issue]
       │
       ▼
1. 预热态 ────── 激活 /caveman + 运行 `doc-radar.js` 强制加载关联 L2 心智胶囊与 TOC (100% 防漏读)
       │
       ▼
2. 初始实现 ──── 按 TDD 与领域不变量编码 + 运行单测与 Typecheck (注意：本阶段严禁提前 git commit)
       │
       ▼
┌──────┴────────────────────────────────────────────────────────────────────┐
│ 3. 自动审查修复循环 (Auto Review-Fix Loop, MAX_ROUNDS = 4)                 │
│                                                                            │
│ ① 【主 Agent】生成 `/review-handoff --blind` (零辩护偏见包, ≤3000 字符)     │
│    附带当前《Loop State Ledger 防振荡冻结账本》                            │
│                        │                                                   │
│                        ▼                                                   │
│ ② 【派生独立子 Agent】调用 `/open-code-review-delegate`                    │
│    强制继承 /caveman 与 TOC First；通过 CLI 获取 diff/rules，独立冷酷盲审   │
│                        │                                                   │
│                        ▼                                                   │
│ ③ 【主 Agent】调用 `/review-vet` 去伪存真 + 更新《Loop State Ledger》       │
│    剥离大词、解耦 Why/How、核验九大硬契约、拦截与 Frozen 项相反的振荡提议   │
│                        │                                                   │
│                        ▼                                                   │
│ ④ 【主 Agent】执行代码修复与回归门禁 (Typecheck + 关联 Vitest/Cargo 单测)   │
│                        │                                                   │
│                        ▼                                                   │
│        【收敛判定】《本轮待执行修复清单》是否为空？                         │
│           ├── 存在真缺陷/低挂果实 ───➔ Round + 1 返回 ①                     │
│           └── 0 缺陷 (Clean Pass) 或触发熔断 ───➔ 退出循环                  │
└──────┬────────────────────────────────────────────────────────────────────┘
       │
       ▼
4. 交付与知识回流自检 ── 输出《演进报告》+《人工裁定清单》+《Doc-Architect 五维回流微检表》
       │
       ▼
5. 任务范围原子提交 ──── 遵循 /smart-git-commit 显式指定 pathspec 提交并推送，严禁通配符
```

## 执行步骤

### 1. 激活 Caveman 与知识雷达预热 (Pre-flight Grounding)
1. 激活 [/caveman](../caveman/SKILL.md) 极简模式，贯穿主/子 Agent 全生命周期。
2. **强制运行知识雷达**：
   ```bash
   node .agents/skills/doc-architect/scripts/doc-radar.js <涉及的文件路径或任务关键词>
   ```
   根据雷达输出的必读 L2 文档与 `@doc-anchor`，按需切片读取，对齐受控概念、数据库创世基线与路径规范。

### 2. 初始功能编码 (Implement without Premature Commit)
- 根据 Spec/Issue 编写业务代码与单元/集成测试，运行类型检查与单测确保全绿。
- **重要禁令**：在循环全部收敛前，**严禁执行 `git commit`**，保持改动处于工作区以便 `ocr delegate preview` 准确捕获全量变更文件。

### 3. 自闭环审查与修复循环 (Review-Fix Loop)
维护一张内存/临时状态表 **《Loop State Ledger》**，按轮次（最多 4 轮）执行：
1. **组装 `--blind` 盲审包**：按 `/review-handoff --blind` 格式组装客观边界与已冻结争议项（严禁夹带作者辩护理由）。
2. **派生独立子 Agent 盲审**：通过 `invoke_subagent` 派生全新子 Agent（Prompt 规范见 [REFERENCE.md](REFERENCE.md)），注意**直接将盲审包注入子 Agent 上下文，不要通过 `ocr -B` 传大文件**以防触发 8000 字符崩溃。
3. **主 Agent 去伪存真与防振荡裁决**：运行 [/review-vet](../review-vet/SKILL.md)，更新《Loop State Ledger》：
   - 若子 Agent 提议将上一轮已修复/已驳回的形态改回原样 ➔ 立即触发 **Oscillation Breaker（振荡熔断）**，冻结该位置并转交人工清单；
   - 得出《本轮待执行修复清单》（含 Critical/High/Medium 真问题及 $\le 5$ 行的极高 ROI 低挂果实）。
4. **修复与回归测试**：若清单为空，立即作为 Clean Pass 退出循环；否则应用修复并跑通 Typecheck 与单测，进入下一轮。

### 4. 输出交付报告与知识回流微检 (Report & Knowledge Reflow Hook)
循环退出后，输出汇总报告，并在末尾强制附带 **《知识图谱回流微检表》**：
- [ ] **原文档纠偏**：本次是否发现既有 L2/L3 文档存在过时或误导描述？（若有，立即就地修正）
- [ ] **字典与模型同步**：是否新增了受控概念码、Runtime 单例服务或核心术语？（若有，同步更新 `public-services-catalog.md` / `CONTEXT.md`）
- [ ] **复盘与 TOC 刷新**：若改动了任何 `docs/` 文档，运行 `pnpm run docs:toc` 与 `check-doc-health.js`。

### 5. 任务范围精准提交 (Task-Scoped Commit)
调用 [/smart-git-commit](../smart-git-commit/SKILL.md)，显式 `git add <task-files...>` 提交并推送。
