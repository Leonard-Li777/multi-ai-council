---
name: plan-handoff
description: 为无法访问本地仓库的外部第三方（如 Web 端 ChatGPT、Claude.ai 或外部专家）生成完全自包含、前因后果完备、直书关键代码签名、且兼顾细节严审与高维更优方案探讨的一键复制审查提示词。Use when preparing a plan/spec/design for external third-party review without local repo access, when user says "生成方案 review 提示词", "打包方案给外部 review", "把方案发给第三方 review", "探讨更优方案", or invokes /plan-handoff.
---

# 方案外部审查移交 (Plan Handoff)

专为**无法访问本地仓库与文件系统的外部第三方**（Web 端 LLM、外部架构师、评审委员会）设计。绝不使用外部打不开的本地相对路径，而是将**业务前因后果、系统底线契约、存量核心代码签名、已否决备选方案与方案全文**直接自包含直书，输出带有 XML 语义隔离、结构化锚点与**升维更优方案探讨槽位**、可一键复制的专业审查提示词。

## 核心流程

```
[开发方案 / Spec / PRD / 架构设计]
       │
       ▼
1. 锚定与预检 (Pre-flight) ── 锁定目标方案 + Smart Inlining 提取关联 ADR 与存量代码签名
       │
       ▼
2. 注入结构化锚点 ────────── 为方案核心章节自动编排 [PLAN-SEC-XX] 锚点，便于下游精准对齐
       │
       ▼
3. 组装自包含提示词 ──────── 组装防脑补铁律 + 契约直书 + 升维更优解通道 + XML 标签隔离
       │
       ▼
4. 生成一键复制文本 ──────── 输出四反引号包裹的自包含提示词，可直接投喂外部并无缝衔接 /review-vet
```

## 执行步骤

### 1. 生成前预检与智能裁剪直书 (Pre-flight & Smart Inlining)
- **方案全文直书**：目标方案（Spec/PRD/架构设计）**100% 完整内联直书**，绝不删减核心逻辑；
- **存量代码签名快照**：自动提取与本方案直接交互的核心接口（Interface）、类型定义（Type/Struct）或数据库建表 DDL，只提取声明签名，不贴实现代码；
- **参考文档智能提纯**：注明文档名与公开 URL（如 GitHub Issue 链接），关联的 ADR 仅直书关键决策结论段落，过滤历史无关废话；
- **底线契约直书**：将 [AGENTS.md](../../../AGENTS.md) 的核心系统铁律（如未上线免 migration、本地单一主库等）明文写入。

### 2. 注入下游对齐锚点 (Downstream Anchoring)
为方案全文的核心章节与任务切片自动标记显式编号（如 `[PLAN-SEC-01: 数据库改造]`、`[PLAN-SEC-02: 内存缓存]`、`[TASK-01]`），以便外部审查者精准引用，杜绝张冠李戴。

### 3. 构建自包含 XML 提示词模块
组装以下模块，各模块使用语义 XML 标签进行物理隔离（详见 [REFERENCE.md](REFERENCE.md)）：
- `<review_mandate>`：红队审查使命 + **【防脑补铁律】** + **【升维审视与替代方案探讨】** + **【防假想敌过度防御与攻防经济学铁律】**（严禁脱离业务价值做金融级学术过度工程）；
- `<business_context_and_threat_model>`：业务现实、资产价值与真实威胁模型边界（资产封闭性与不可提现性、真实攻击者动机与现实成本约束、误杀客诉一票否决）；
- `<system_invariants>`：不可动摇的系统底线与硬性契约；
- `<codebase_interface_snapshot>`：存量核心代码接口与数据结构签名；
- `<inlined_references>`：相关文档名、公开 URL 及关键决策直书；
- `<rejected_alternatives>`：已被否决的备选方案与舍弃原因；
- `<target_plan>`：带 `[PLAN-SEC-XX]` 锚点的方案全文；
- `<focus_areas>`：开发者重点疑虑与主动挑刺清单；
- `<output_template>`：首尾双锚定唤醒词 + `[ISS-XX]` 元数据格式 + **`[ALT-PARADIGM]` 升维更优方案专用槽位**。

### 4. 输出一键复制成果
将组装好的内容放置在四反引号 ````markdown ... ```` 代码块中，提示用户点击右上角一键复制。审查结论拿回后，可直接输入 [/review-vet](../review-vet/SKILL.md) 自动化去伪存真！

---

- 详细 XML 模块规范、提示词装配模版与自适应模式：见 [REFERENCE.md](REFERENCE.md)
- 真实场景自包含提示词与外部反馈范例：见 [EXAMPLES.md](EXAMPLES.md)
