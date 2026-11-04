---
name: domain-modeling
description: 维护与锋利化项目的领域模型、术语词汇表（CONTEXT.md）与架构决策记录（docs/adr/）。在讨论代码库术语、编写/编辑 CONTEXT.md 或受控概念枚举、记录 ADR 时使用。Use when discussing codebase terminology, working with CONTEXT.md, or recording/editing an ADR.
---

# Domain Modeling (领域建模与受控概念治理)

主动构建并锋利化项目的领域模型。这是**主动式纪律**：挑战模糊术语、发明极端场景进行边界压力测试，并在概念凝聚的瞬间将术语表（`CONTEXT.md`）与架构决策（`docs/adr/`）落盘。

---

## 目录与文件拓扑

本仓库采用根目录统筹或多 Context 映射结构：

```text
/
├── CONTEXT.md         ← 全局业务术语与受控概念词汇表
├── CONTEXT-MAP.md     ← 多 Context 映射图（若存在）
├── docs/
│   └── adr/           ← 系统级架构决策记录 (ADR)
│       ├── 0001-single-master-db-genesis.md
│       └── 0002-omni-semantic-pack-isolation.md
└── src/
```

仅在有内容可写时才懒加载创建文件。
若没有 `CONTEXT.md`，在解析出第一个领域术语时创建它；若没有 `docs/adr/`，在需要第一篇 ADR 时创建它。

---

## 核心工作纪律 (Active Discipline)

### 1. 挑战不合规范的术语
当用户使用的术语与现有的 `CONTEXT.md` 或 `AGENTS.md §2.3`（受控概念铁律）发生冲突时，立即指出：“您的术语定义为 X，但此处似乎表达 Y。请问两者的准确边界是什么？”

### 2. 剔除模糊语言，锚定受控码
当用户使用模糊或过载的泛化词汇时，引导其收敛至官方受控概念：
例如：“您提到‘分类标签’，请问是指 OMW 本体概念代码 `omw.*`、HowNet 概念代码 `hownet.*` 还是内部展示别名？两者在持久化和语义检索中有严格隔离。”

### 3. 以极端场景进行压力测试 (Concrete Scenarios)
讨论领域关系时，编造探测边界的极端场景（如：非视觉音频文件被传入视觉画质打标管道、离线状态下语义包加载失败、超大 4K 图像突发并发处理等），迫使模型与用户在边界仲裁上保持精确。

### 4. 实时内联更新 CONTEXT.md
术语一旦敲定，立即实时写入 `CONTEXT.md`（遵循 [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) 格式规范），决不积压。
**绝对底线**：`CONTEXT.md` 严禁混入任何实现细节（如类名、SQL 语句、Electron API、文件行号）。它纯粹是业务语言的无瑕疵术语词汇表。

### 5. 极其克制地提供 ADR 建议
只有当三项条件全部同时满足时，才主动建议创建 ADR（遵循 [ADR-FORMAT.md](./ADR-FORMAT.md)）：
1. **难以逆转 (Hard to reverse)**：未来改变主意的代价极其昂贵（如：采用单一主库不走 migration 方案、Omni 独占加密 semantic.pack 架构）；
2. **脱离上下文令人惊讶 (Surprising without context)**：未来的工程师看到这段代码会疑惑“为什么非要这么做？”；
3. **真实取舍的产物 (Real trade-off)**：存在真实的备选方案，而团队基于特定系统约束（如 Windows 平台、单机 Electron 隐私保护、零云端依赖）做出了有意识的抉择。

若三项中缺少任意一项，跳过 ADR。
