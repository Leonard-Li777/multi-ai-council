---
name: plan-loop
description: 编码前的方案、需求与架构设计多轮红队审查打磨流水线（v2.0 确定性增强版）。先激活 caveman 极简模式并运行 doc-radar.js 预加载领域不变量，锁定或生成方案文档后，驱动「组装零偏见方案盲审包 + 防振荡账本 -> 独立子 Agent 六维雷达盲审（兼顾代码事实、硬契约与高维更优范式）-> 主 Agent 调用 review-vet 去伪存真 -> 原地修订方案文档 & 刷新 TOC」，直到方案自洽完备且验收标准 100% 可量化，输出就绪报告与人工裁定项。Use when user wants to refine, critique, and iteratively polish a technical plan, design doc, PRD, spec, or task breakdown before coding, says "plan-loop", "打磨方案", "方案review loop", or invokes /plan-loop.
---

# 方案多轮红队审查与自闭环打磨 (Plan Loop v2.0)

在编写任何业务代码之前，针对技术方案、架构设计或需求文档（如会话方案草案，或由 `/to-prd`、`/to-spec`、`/to-issues` 生成的文档），通过「知识雷达锚定 ➔ 独立红队子 Agent 六维盲审 ➔ 主 Agent 去伪存真与防振荡冻结 ➔ 原地修订文档」的闭环迭代，消灭架构死穴、突破局部最优并对齐契约。

## 核心流程

```
[开发方案 / 会话草案 / PRD / Spec / Issues]
       │
       ▼
1. 预热与锁定 ── 激活 /caveman + 锁定目标方案文件 + 运行 `doc-radar.js` 提取必守领域不变量
       │
       ▼
┌──────┴──────────────────────────────────────────────────────────────────────┐
│ 2. 自动方案审查与打磨循环 (Plan Review-Refine Loop, MAX_ROUNDS = 3)          │
│                                                                              │
│ ① 【主 Agent】组装《零偏见方案盲审包》+《Plan Loop State Ledger 防振荡账本》  │
│    提供：业务目标 + 目标方案路径 + 雷达命中的 L2/L3 契约 + 已冻结架构争议点   │
│                        │                                                     │
│                        ▼                                                     │
│ ② 【派生独立子 Agent】基于「红队六维方案雷达」执行独立冷酷盲审                │
│    直读方案全文与关联代码，输出结构化缺陷清单与【升维更优范式提议】           │
│                        │                                                     │
│                        ▼                                                     │
│ ③ 【主 Agent】调用 `/review-vet` 去伪存真 + 更新《Plan Loop State Ledger》   │
│    提纯真实漏洞；轻量更优范式原地吸收入方案；重大架构分歧呈报人工决断        │
│                        │                                                     │
│                        ▼                                                     │
│ ④ 【主 Agent】原地修订方案文档 (In-place Edit)                               │
│    真实修改本地 Markdown，吸纳更优范式、补齐异常流、修正签名、量化 AC        │
│                        │                                                     │
│                        ▼                                                     │
│        【收敛判定】《本轮方案待修订清单》是否为空？                           │
│           ├── 存在真实漏洞/契约冲突 ───➔ Round + 1 返回 ①                    │
│           └── Clean Pass (0 阻断项) 或触发熔断 ───➔ 退出循环                 │
└──────┬──────────────────────────────────────────────────────────────────────┘
       │
       ▼
3. 目录刷新与健康门禁 ── 运行 `pnpm run docs:toc` 覆盖刷新目录 + `check-doc-health.js` 验死链
       │
       ▼
4. 就绪交付与精准提交 ── 输出《方案就绪交付报告》+ 显式提交本次方案文档基线 (严禁通配提交)
```

## 执行步骤

### 1. 激活极简通信与知识雷达锚定 (Caveman & Radar Lock)
1. 激活 [/caveman](../caveman/SKILL.md) 规则，全程剔除客套废话。
2. **锁定目标方案文档**：指定路径直接锁定；或先调用 [/to-spec](../to-spec/SKILL.md) 固化初版 L3 Spec。
3. **强制运行知识雷达**：运行 `node .agents/skills/doc-architect/scripts/doc-radar.js <方案路径>`，提取命中的 L2 枢纽与九大硬契约。

### 2. 执行方案审查与打磨循环 (Review-Refine Loop)
维护一张内存状态表 **《Plan Loop State Ledger》**，按轮次（最多 3 轮）执行：
1. **组装零偏见方案盲审包**：打包业务诉求、目标方案精确路径、硬契约、现有代码路径与账本（严禁写辩护词诱导子 Agent）。
2. **派生独立红队子 Agent 盲审**：调用 `invoke_subagent`，对照「六维方案审查雷达」（物理事实、硬契约、KISS、异常兜底、量化AC、升维更优解）核查代码库，输出结构化缺陷与更优解提议。
3. **主 Agent 调用 `review-vet` 去伪存真**：
   - **升维更优解裁决**：若发现根本性更优范式（大幅降低复杂度/消灭竞态），轻量优化直接原地重构方案；重大架构路线分歧在账本中记为 `Pivot-Option` 并作为备选路线呈报人工；
   - 驳回脱离桌面端实际的过度工程并标记为 `Frozen`；触发 **Oscillation Breaker** 阻断反复振荡；提纯出《本轮待修订清单》。
4. **原地修订方案文档 (In-place Refinement)**：
   - 若待修订清单为空，立即作为 **Clean Pass** 跳出循环；
   - 否则直接编辑本地 Markdown 文档，吸收更优范式、补齐悲观降级、修正表结构、量化 AC 指标。

### 3. 自动化 TOC 刷新与拓扑体检 (TOC & Health Gate)
循环收敛后，立即运行 `pnpm run docs:toc` 刷新前置 TOC，并运行 `node .agents/skills/doc-architect/scripts/check-doc-health.js` 验证零死链。

### 4. 输出方案就绪报告与精准提交 (Delivery & Scoped Commit)
1. 输出汇总报告：包含打磨演进摘要（含防振荡账本）、最终方案路径、需人工裁定的重大架构路线/产品偏好、及直通 `/implement-loop` 指引。
2. **显式隔离提交**：核对 `git status`，仅 `git add <方案及挂载文档>` 并提交（严禁 `git add .`）。

---

- 详细红队六维雷达、子 Agent 零偏见通信协议与防振荡熔断机制：见 [REFERENCE.md](REFERENCE.md)
- 完整端到端方案打磨实战案例：见 [EXAMPLES.md](EXAMPLES.md)
