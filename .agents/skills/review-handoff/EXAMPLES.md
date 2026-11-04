# 移交代码审查案例库 (EXAMPLES)

本文件展示在真实工程变更完成后，通过 `review-handoff` 利用会话记忆与文档溯源生成的双模审查数据包范例（含对外移交与对内盲审），以及兼顾局部事实与高维范式跃迁的评审结构。

---

## 范例一：对外 `--external` 完整移交提示词与外部反馈

### 场景背景
开发者与 AI 依据 [ADR-0037](docs/adr/0037-single-master-db-and-global-schema.md) 与 [Issue #655](https://github.com/Leonard-Li777/firefly-ai-folder/issues/655) 完成了标签别名持久化治理。此时直接调取会话记忆并链接对应 PRD 与 Issue，生成以下一键复制交付内容：

### 1. `/review-handoff --external` 输出的一键复制内容

````markdown
# 代码审查委托：单一主库下的标签别名与展示名持久化治理

你好！请作为资深架构与代码评审专家，对我们刚完成的标签持久化改造进行专业、严谨且务实的审查。

## 一、需求源头与参考文档 (Grounding Docs)
为避免脱离实际架构背景盲目猜测，请务必先查阅本次改造所依据的权威规范：
- **关联 Issue**：[Issue #655: 数据库架构三阶段演进总规范](https://github.com/Leonard-Li777/firefly-ai-folder/issues/655)
- **规格说明书 (PRD/Spec)**：[`docs/specs/database-evolution-three-phases-spec.md`](docs/specs/database-evolution-three-phases-spec.md)
- **架构决策依据 (ADR)**：
  - [`docs/adr/0037-single-master-db-and-global-schema.md`](docs/adr/0037-single-master-db-and-global-schema.md)（单一主库与全局 Schema 现行架构）
  - [`docs/adr/0045-tag-provenance-group-and-confidence-policy.md`](docs/adr/0045-tag-provenance-group-and-confidence-policy.md)（标签源、置信度与免 migration 策略）
- **核心约束文档**：[`AGENTS.md`](AGENTS.md)「版本与兼容性」章节

## 二、审查原则与纪律
1. **事实为本**：所有缺陷指出必须定位到具体文件与代码行，并在真实运行时调用链路中可触发；
2. **严防无据加戏**：主线缺陷审查中请严格对照 In-Scope 范围，切勿把凭空捏造的商业流程作为阻塞性缺陷；
3. **欢迎高性价比建设性建议**：我们非常欢迎具有高商业价值或架构演进意义的好点子！如果您发现了此类机会，**请务必显式标注【超纲建议】并简要论证其投入产出比（ROI）**，只要性价比高，我们很乐意采纳！
4. **【升维审视与替代方案探讨】**：不要只做局部代码改动的“行级校对员”！若站到更高系统维度审视，发现当前实现陷入了局部最优（例如用大量复杂代码防御了一个本可通过单向数据流或底层既有基础设施直接消灭的问题），极度欢迎在文末专门输出《升维更优方案探讨 (Alternative Paradigm Proposal)》，阐明为什么新方案更好，并给出对比矩阵与重构建议！

## 三、需求背景与范围
- **本次交付目标 (In-Scope)**：
  1. 废弃多语言分库写入路径，标签身份完全锚定全局稳定 `code`；
  2. 标签在界面上的多语言展示统一由 `tag_aliases` 表管理，不再动态拼接语言后缀；
  3. 创世基线 `GENESIS_V1_SCHEMA` 更新，补全 `tag_aliases` 索引。
- **明确非目标 (Explicit Non-Goals，本次不做)**：
  1. 不涉及云端模型接口改动与付费配额逻辑；
  2. 不重写虚拟目录树的所有前端交互动画；
  3. 不做历史遗留未加密 raw.db 的兼容迁移。

## 四、不可破坏的系统既定契约
- **数据库规则**：本项目未正式发布上线，数据库 Schema 修改**直接修改创世基线 `GENESIS_V1_SCHEMA`**（位于 `database.ts`），**无需且严禁**编写额外的 `ALTER TABLE` 迁移脚本（遵循 ADR-0045 与 AGENTS.md）；
- **语义库规则**：业务代码**严禁**引用 `semantic.raw.db`，所有语义别名统一走 Omni 解密托管的 `semantic.pack` 接口；
- **平台与规范**：基于 Windows 环境开发，包管理器使用 `pnpm`，代码关键注释必须保留中文。

## 五、核心设计决策与折中（源自当前开发上下文）
- **为何将别名全量加载至内存 Map**：
  本地标签总数规模通常在 3,000 以内。在服务启动时由 `TagPersistenceService` 将别名映射在内存中做归一化索引，单次搜索延迟从 35ms 降低至 0.8ms，且极大减轻 SQLite 锁竞争。舍弃了直接在 SQLite 中频繁触发 `LIKE '%...%'` 的方案。

## 六、关键改动文件与导览 (Tour of Changes)
建议按以下顺序阅读核验：
1. `apps/desktop/src/electron/runtime-services/database/database.ts`: 创世基线中 `tag_aliases` 表与索引定义；
2. `apps/desktop/src/electron/runtime-services/tag-persistence-service.ts`: 标签身份与别名读写核心；
3. `apps/desktop/src/electron/runtime-services/tag-matcher.ts`: 内存归一化匹配引擎；
4. `apps/desktop/pro/tests/tag-aliases.test.ts`: 单测覆盖验证。

## 七、开发者重点关切点（请重点审查）
1. `tag-matcher.ts:52` 处的多语言字符归一化函数，在遇到特殊全角符号时是否存在意外碰撞？
2. 内存缓存与 SQLite 持久层之间的更新同步，在极端并发写入时是否有脏读风险？

## 八、期望的反馈格式
请按以下结构分栏提供您的评审结论：
1. **【阻断性缺陷】**（违背主线目标、引发崩溃、死锁或脏写的问题）
2. **【边界与健壮性改进】**（未处理的空值、极端输入、异常捕获）
3. **【高性价比超纲建议】**（显式标注【超纲】，注明“收益为何显著”以及“为何实现成本很低值得采纳”）
4. **【🌌 升维更优方案探讨】**（可选：若跳出当前代码实现思维存在根本性更优解，请给出高维思路、对比矩阵与重构建议）
5. **【已验证通过的设计亮点】**（简短指出当前实现的优秀之处）
````

---

### 2. 外部审查者返回的结构化反馈范例

```markdown
### 评审意见回复

#### 1. 【边界与健壮性改进】
- `tag-matcher.ts:54`: 全角英文字符归一化未覆盖全角数字（如 `１２３`），建议增加 NFKC 规范化处理。

#### 2. 【高性价比超纲建议】
- **【超纲建议】支持拼音首字母匹配 (Acronym Search)**：
  - **ROI 分析**：桌面端中文搜索使用首字母缩写（如 `bgr` 匹配“办公日记”）是极高频本能操作。在 `tag-matcher.ts` 构建内存索引时多生成一个简拼字段即可，成本仅 10 行代码，体验提升巨大。

#### 3. 【🌌 升维更优方案探讨 (Alternative Paradigm)】
- **核心主张与高维视角**：
  审视当前 `tag-persistence-service.ts` 与 `tag-matcher.ts`：当前实现采用了“在 SQLite 写入后，通过局部加锁并增量更新内存可变 Map”的传统锁机制。
  但单机桌面端标签总规模极小（< 3000 条，全量索引 < 2MB）。若跳出“加锁增量维护”思维，升级为**不可变快照原子替换 (Copy-On-Write Atomic Swap)**：
  - 写入 SQLite 成功后，直接在后台生成全新的冻结只读索引对象，并通过 Node.js 单线程原子引用替换生效；
  - 检索线程永远零锁访问冻结快照，彻底消灭所有并发读写锁竞争与微秒级脏读漏洞。
- **对比矩阵**：
  | 维度 | 当前实现 (增量更新 + Mutex 读写锁) | 升维更优方案 (COW 不可变快照) |
  | :--- | :--- | :--- |
  | **并发复杂度** | 需维护细粒度 Mutex 与异常回滚 | **完全零锁**，无竞态可能 |
  | **代码量** | 约 160 行同步与锁代码 | **约 45 行纯函数**，减少 70% |
  | **契约对齐** | 合规 | 极度契合桌面单机 KISS 原则 |
- **重构建议**：
  由于改动仅局限在 `tag-matcher.ts` 内部状态管理，对外公开接口不变，建议在后续小 PR 中直接无痛替换。

#### 4. 【已验证通过的设计亮点】
- 彻底废弃了动态表名分库写入，全局受控码与创世基线索引设计非常干净规范。
```

---

## 范例二：对内 `--blind` 紧凑盲审包输出范例（用于 implement-loop）

在 `implement-loop` 派生独立子 Agent 时，输出紧凑、零作者辩护且注入冻结账本的数据包（严格 $\le 3,000$ 字符）：

```markdown
## [BLIND-REVIEW-PACKET] 内部独立盲审约束包 (Round 2)

### 1. 权威需求源头与必读规范 (先读前 60 行 TOC)
- **关联 Spec**: `<docs/specs/tag-aliases-spec.md>`
- **必读领域规范 (L2)**: `<docs/developer/standards/controlled-concepts-guide.md>`

### 2. 范围边界 (Scope Boundary)
- **In-Scope (本次必达目标)**:
  - 落地 `tag_aliases` 创世基线表与索引；
  - 实现内存 `TagMatcher` 实时检索与多语言别名索引；
  - 提供别名持久化 IPC 读写通道。
- **Explicit Non-Goals (明确不做，严禁在此方向加戏)**:
  - 严禁引入 Redis/分布式缓存；
  - 不改造前端虚拟目录树交互动画。

### 3. 一票否决级系统硬契约 (System Invariants)
- **数据库**: 直接修改 `GENESIS_V1_SCHEMA`，严禁 `ALTER TABLE` 迁移脚本；本地唯一主库 `firefly-ai-folder.db`。
- **受控概念**: 严守 `omw.* > hownet.* > builtin.*`；禁止自然语言或 `t()` 参与比对。
- **KISS 单机极简**: 拒绝外部重型中间件，优先纯函数与内存不可变快照。

### 4. 待审文件清单 (Target Files)
- `apps/desktop/src/electron/runtime-services/database/database.ts`
- `apps/desktop/src/electron/runtime-services/tag-persistence-service.ts`
- `apps/desktop/src/electron/runtime-services/tag-matcher.ts`

### 5. 防振荡冻结账本 (Frozen Oscillation Ledger — 严禁反向提议)
- R1 已驳回 Redis 引入提议（标记为 Frozen）；
- R1 已采纳 Copy-On-Write 不可变快照架构（标记为 Pivot-Fixed，禁止要求改回 Mutex 锁）。

### 6. 审查深度与升维探讨指令 (Review Mandate)
- **主线事实查验**: 严查代码真实性与硬契约，严禁脑补加戏；
- **升维更优解探索**: 若站在系统全局审视发现根本性更优架构解，必须显式提出【升维更优方案探讨】。
```
