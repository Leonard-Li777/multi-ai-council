---
name: doc-architect
description: 自生长防腐蚀文档架构与业务心智治理专家（v2.0）。基于 4 环同心圆骨架、L2「30行业务心智胶囊」与确定性知识雷达（doc-radar.js）维护知识图谱，确保 Agent 100% 零遗漏召回必备规范并深刻理解业务不变量；执行会话知识五维回流、TOC 覆盖刷新与零死链/零死锚门禁体检。Use when 需要整理或新增文档、开发后复盘归档、更新文档架构、检查死链与锚点健康度, says "doc-architect", "文档架构", "整理文档", "图谱防腐", "文档治理", or invokes /doc-architect.
user-invocable: true
---

# Document Architect (知识拓扑与业务心智治理 v2.0)

基于「4 环同心圆骨架 + 确定性知识雷达 (`doc-radar.js`) + L2 业务心智胶囊」管理全系统文档的自生长、零遗漏召回与防腐。

## Quick Start (核心确定性工具集)

```bash
# 1. 任务前置预检：根据改动路径或关键词，确定性召回必读 L2 心智胶囊与 L3 TOC (防漏读)
node .agents/skills/doc-architect/scripts/doc-radar.js --git

# 2. 自动扫描并直接覆盖刷新所有文档的开篇 TOC 目录导航 (保证与最新正文 100% 同步)
pnpm run docs:toc

# 3. 运行 4 环拓扑健康度门禁 (L1 配额、L1~L3 全覆盖零死链、#anchor 真实性校验、防跨环穿透)
node .agents/skills/doc-architect/scripts/check-doc-health.js
```

## 核心拓扑与心智高密度契约 (Topology & Mental Model Invariants)

### 1. 4 环同心圆骨架与连接双铁律
- **L1 (Kernel)**: `AGENTS.md`（底层红线 + 确定性路径/符号路由矩阵，配额 $\le 120$ 行，仅连 L2）
- **L2 (Standards & Hubs)**: 领域架构、开发规范与单例字典（承上启下枢纽，向下索引 L3，建议 $\le 300$ 行）
- **L3 (Deep Specs & PRDs)**: 权威审定的纵深规格与 PRD（前 60 行强制带 TOC，向下关联 L4）
- **L4 (Context & History)**: 任务复盘 (`docs/retro/`)、归档 (`docs/archive/`) 与切片工单 (`docs/issues/`)
- **连接双铁律**：**同环网状自由串联** ($L_n \leftrightarrow L_n$)；**异环严格单级相邻** ($L_n \leftrightarrow L_{n \pm 1}$，严禁跨环穿透)。

### 2. 防漏读与高业务理解三大工程机制 (Anti-Omission & Deep Comprehension)
为了让 Agent 在极低 Token 消耗下瞬间建立资深开发者的业务理解，所有 L2/L3 文档必须贯彻以下三大结构标准：
1. **L2 强制配备「30 行业务心智模型胶囊 (Domain Mental Model Capsule)」**：
   每篇 L2 枢纽文档在开篇 TOC 之后的第一节，必须浓缩一个 $\le 30$ 行的心智胶囊，包含：
   - **状态与数据流公式**：单行箭头链条展示核心流转（如 `Ingress 归一化 -> 内存纯 Code 运算 -> 领域排他仲裁 -> Egress 展示`）；
   - **领域核心不变量 (Invariants)**：3~5 条绝对不可破坏的业务铁律；
   - **高频踩坑正反例对照 (`❌ vs ✅`)**：直观展示历史真坑代码对比。
2. **源码与 L3 双向锚定 (`@doc-anchor`)**：
   在核心 Runtime Service 或复杂算法源码文件头部前 30 行注释中，鼓励标注 `// @doc-anchor: docs/specs/xxx-spec.md#章节锚点`，供 `doc-radar.js` 自动嗅探召回。
3. **结论先行式章节命名**：
   L2/L3 的 H2~H4 标题应直接体现核心规则（如 `### 3.2 多父回溯仲裁（按媒体域排他分派，禁跨领域平局 Fallback）`），使自动生成的 TOC 本身即成为高密度规则索引。

## 治理工作流 (Governance Workflow)

### 阶段 0：会话知识回流五维审查 (Session Harvesting)
1. **原文档就地纠偏 (Source Doc In-place Fix)**：若会话中出现认知偏差或用户纠偏，溯源是否为既有 L2/L3 文档表述模糊、过时或错误所致。若是，**必须立即回到原文档就地勘误**，严禁只记在复盘里；
2. **领域模型提炼 (`/domain-modeling`)**：涌现新实体、受控概念或重大权衡时，同步更新 `CONTEXT.md` 或新增 `docs/adr/`；
3. **关联枢纽与雷达规则同步**：若新增了核心单例服务或新领域规范，同步更新 `public-services-catalog.md`、`AGENTS.md §3` 路由矩阵及 `doc-radar.js` 的 `RADAR_RULES`；
4. **重要度升降级 (Promote & Demote)**：全局红线提炼 1~2 行升入 L1 `AGENTS.md §2`；废弃旧规范插入 `SUPERSEDED` 标头并移入 L4 `docs/archive/`；
5. **复盘沉淀 (`/retro`)**：复杂排障或多轮对抗审查后，落盘至 L4 `docs/retro/YYYY-MM-DD-<topic>.md`。

### 阶段 1~4：分层归位、上下级单级挂载、同环织网与防腐废弃
- 严禁物理硬删被取代的旧规范，按「加注 `SUPERSEDED` 标头 ➔ 移入 `docs/archive/` ➔ 更新父级 L2 指针」三部曲执行。

### 阶段 5：自动化目录导航覆盖刷新 (`pnpm run docs:toc`)
- 任何文档新增或修改小节标题后，**必须运行 `pnpm run docs:toc`** 直接覆盖刷新开篇 TOC。
- 锚点唯一正尺：严格遵循 `scripts/generate-doc-toc.js` 的 `generateGithubSlug()` 算法（GitHub 渲染实态：不折叠连续 `-`、不去首尾 `-`、同名按序加 `-1/-2`）。
- 注意事项：工具存在“紧邻原空行时首跑多留 1 行空行、二跑收干定点”的特性，属正常现象；连续运行两次 `pnpm run docs:toc` 即可达到逐字节定点。

### 阶段 6：确定性门禁体检 (`check-doc-health.js`)
- 运行 `node .agents/skills/doc-architect/scripts/check-doc-health.js`；
- 确保：L1 行数 $\le 120$ 行、L1~L3 物理死链为 0、`#anchor` 失效死锚为 0、跨环穿透违规为 0。
