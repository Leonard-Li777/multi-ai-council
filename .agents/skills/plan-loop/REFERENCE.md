# 方案多轮审查与自闭环打磨参考手册 (REFERENCE v2.0)

本手册详细规范了 `plan-loop` 的红队六维方案审查雷达、解耦 Git 状态的双模子 Agent 通信协议、《Plan Loop State Ledger》防振荡账本与收敛熔断机制。

---

## 一、红队「六维方案审查雷达」(6-D Spec Review Radar)

方案审查的核心使命是在写第一行代码前，消灭会导致“写到一半推倒重来”的架构硬伤，并探寻根本性更优解。子 Agent 必须强制扫描以下六个维度：

```
                              [1. 物理可行性与代码事实核验]
                                          ▲
                                          │
   [5. 垂直切片与 AC 可测性] ◄────────────┼────────────► [2. 仓库九大系统硬契约]
                                          │
   [4. 悲观路径与并发兜底]   ◄────────────┼────────────► [3. KISS 与反过度工程]
                                          │
                                          ▼
                           [6. 升维审视与更优解空间探索]
```

### 1. 维度一：物理可行性与既有代码事实核验 (Code Reality & Feasibility)
- **严禁纸上谈兵**：子 Agent 必须去代码库中核实方案提及的既有 Service、IPC 通道、Rust 结构体或数据库表是否真实存在！
- **排查项**：
  - 方案假定复用的方法签名、返回值或异步时序与现有代码（如 `public-services-catalog.md`）是否冲突？
  - 是否存在跨进程 IPC 高频序列化阻塞、SQLite 写锁竞争或死锁隐患？

### 2. 维度二：仓库九大不可动摇硬契约对齐 (System Invariants Check)
对照 `AGENTS.md` 与 `doc-radar.js` 输出的领域不变量，**一票否决**任何违背项：
- **数据库创世基线**：严禁设计 `ALTER TABLE` 迁移脚本或 `migrations` 版本递增，必须直接修改 `GENESIS_V1_SCHEMA`；本地唯一主库 `firefly-ai-folder.db`，严禁业务层触碰 `semantic.raw.db`；
- **受控概念与排他门控 (PRD-0058)**：严守 `Ingress -> Processing(纯Code/枚举) -> Egress`；严守 $\text{omw.*} \succ \text{hownet.*} \succ \text{builtin.*}$；非视觉介质（音频/文档/代码/压缩包）严禁挂载视觉维度；严禁自然语言字符串或 `t()` 参与逻辑比对；
- **路径与同步底线**：比较层路径保持原生 `path.sep` 严禁转 `/`；Supabase 同步必须 `sanitizeObject` 清 `\u0000` 并做父子表外键级联过滤；
- **降级可观测与命名防腐**：检索/数据链路的降级必须 `logger.warn` 上报，严禁静默吞异常返回空集；能力补位实现严禁命名为 `legacy*`。

### 3. 维度三：KISS 原则、攻防经济学与反过度工程 (KISS, Attack Economics & Anti-Overengineering)
- **拦截假想敌与金融级妄想症**：严格对照资产价值与攻防经济学，严禁把几十元不可变现、封闭在单机软件内的工具代币当成千万级加密货币冷热钱包防御；严禁假想黑客盲猜 2^256 机器码并冒刑法风险用强实名微信盗号；严禁引入本地秘密 HMAC、公钥信任根、管理员二次确认等导致真实用户误杀客诉的脆弱 PKI。
- **保护核心转化漏斗，严禁边缘状态机自毁**：严禁为了 0.0001% 的极端罕见手误（如扫码付错机器），在支付到账等核心转化链路上增加二次确认弹窗或 pending_confirm 待确认状态机；极端偶发手误统一交由人工客服后台换绑兜底，绝不牺牲 99.9999% 付费用户的即时满足感。
- **架构极简底线**：拦截“在单机桌面端引入分布式中间件（Redis/BullMQ/消息队列）”、“为极低概率假想场景设计多层抽象工厂”或“擅自扩充商业配额/计费表”的加戏伪需求。能用内存 `Map` 或 5 行防御判断解决的问题，绝不允许膨胀为独立子系统。

### 4. 维度四：悲观路径与异常兜底 (Sad Path & Fail-safes)
- 本地 AI 推理超时、Omni 进程崩溃、文件被外部占用锁死、半途取消任务或局部事务失败时，状态机如何优雅降级与回滚？内存缓存与 SQLite 如何保持最终一致？

### 5. 维度五：垂直任务切片与验收标准可测性 (Tracer Bullets & Quantifiable AC)
- 任务拆解是否为端到端打通（Schema + 核心逻辑 + IPC/UI + 测试）的细长垂直切片？
- 验收标准（AC）是否 100% 可通过自动化测试或明确数值指标（如 `耗时 <= 10ms`、`返回错误码 ERR_XXX`）验证？彻底消灭“体验流畅”、“结构清晰”等主观废话。

### 6. 维度六：升维审视与更优解空间探索 (Higher-Dimensional Paradigm & Global Optima)
- **打破局部最优陷阱 (Break Local Optima)**：
  严禁单纯顺着原 Plan 的思维定势做微观打补丁！子 Agent 必须后撤一步、站到更高全局架构与第一性原理高度审视：
  - 本方案是否在“给错误的方向打复杂的补丁”？（例如为了解决多处缓存不一致，设计了大量复杂的双向同步与事件回滚，而根本上采用不可变单向数据流或单一数据源即可彻底消除问题）；
  - 是否存在“降维打击”式的架构范式跃迁？能否直接复用现有基础设施（如已有 IPC 通道、SQLite 索引视图、Rust 核心服务等）以极小代价消灭本方案原本规划的庞大自建模块？
- **升维更优解评估与分级**：
  - **轻量升维 (Lightweight Paradigm Evolution)**：改动在同一业务范围内，不推翻既定产品目标，但大幅降低系统复杂度、锁竞争或代码量。主 Agent 应原地重构采纳；
  - **重大路线分歧 (Architectural Pivot Point)**：提出颠覆原定产品交互或重构上游核心依赖的宏观新路线。主 Agent 严禁擅自替人类做主，而应将其沉淀为 Spec 的《备选架构演进路线》，并在最终交付报告中重点呈现为“架构路线决断点”。

---

## 二、子 Agent 零偏见派生通信协议 (Subagent Protocol)

为解决目标方案文件“可能已 git commit 导致 `ocr delegate preview` 返回空集”的问题，并防止 `ocr -B` 8000 字符崩溃，子 Agent 采用 **「显式路径直读为主 + `ocr` 辅助为辅」** 的无死角协议。

### 派生指令与 Prompt 标准模板
主 Agent 调用 `invoke_subagent`：
- **Role**: `Red-Team Spec Architect`
- **Model**: `inherit`
- **Prompt 组装规范**：
  ```markdown
  [Caveman mode REQUIRED: drop all pleasantries and filler. Focus 100% on technical flaws & higher-dimensional opportunities.]
  请作为冷酷严苛的架构红队审查员，对我当前的技术方案文档进行深度代码事实核验与六维盲审。

  【一、审查目标方案文件（强制直接读取全文）】：
  - 目标方案路径：`<docs/specs/xxx-spec.md>`
  （注：无论该文件在 git status 中是否已提交，你都必须直接读取该文件全文进行逐节审查；若工作区有未提交改动，可辅以 `ocr delegate preview --format json` 查看关联变更，但严禁因 preview 为空而跳过审查！）

  【二、业务目标与范围边界】：
  - 核心诉求：[1~2 句话客观描述要解决的痛点]
  - 明确非目标 (Out-of-Scope)：[列出不做的事项，严禁在此方向加戏]
  - 资产与攻防底线：严格以单机低价值不可提现代币事实为准，严禁设计金融级零信任/PKI防假想敌；严禁为十万分之一手误破坏核心支付转化漏斗（偶发手误走客服后台兜底）。

  【三、必须对齐的系统硬契约与必读规范 (由 doc-radar.js 提取)】：
  - 必读 L2 规范路径：`<docs/developer/standards/xxx.md>`（查阅长文档必须先读前 60 行 TOC 按需切片！）
  - 核心领域不变量：
    [粘贴 doc-radar.js 输出的 Invariants 列表 + AGENTS.md 九大红线摘要]

  【四、防振荡冻结账本 (Plan Loop State Ledger — 严禁反向提议)】：
  [列出前序轮次已 Fixed 或经 review-vet 裁决 Frozen 的设计决策。禁止要求改回已冻结的旧形态！]

  【五、审查动作与输出格式】：
  1. 读取目标方案文档，并去代码库核实其引用的现有文件、接口签名与数据表是否真实匹配；
  2. 严格对照「六维方案审查雷达」扫描，按以下结构输出报告（若方案完全自洽达标，直接输出【Clean Pass】）：
     - `[Critical/High] <方案路径:行号或章节> [维度分类]`: <指出具体技术死穴、代码事实不符或硬契约违背，并给出最小修正建议>
     - `[Medium] <方案路径:行号或章节> [维度分类]`: <指出过度工程、悲观路径遗漏或不可测的模糊 AC>
     - `[Low-Hanging Fruit / 高ROI补全]`: <成本极低但能显著消除边界隐患的建设性补充>
     - `[Paradigm Alternative / 升维更优解提议]`: <若存在跳出当前 Plan 思维的根本性更优方案，给出高维视角、对比矩阵与落地可行性；若无则注明“当前方案方向已属最优”>
  ```

---

## 三、《Plan Loop State Ledger》防振荡账本与熔断机制

主 Agent 在循环期间维护如下账本，杜绝第 $N$ 轮与第 $N+1$ 轮子 Agent 意见相左导致的无限死循环：

```markdown
### 📋 Plan Loop State Ledger
| Round | Section / Line | Subagent Critique | Vet Decision | Evolution ($\alpha \rightarrow \beta$) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R1 | `§3.1 Schema` | 提出写 `0002_alter.sql` | ✅ 采纳 (违背创世单库) | 迁移脚本 ➔ 直接改 `GENESIS_V1_SCHEMA` | Fixed |
| R1 | `§2.3 缓存层` | 要求引入本地 Redis 缓存 | ❌ 驳回 (单机过度工程) | 保持内存 `Map` (<3000条) | **Frozen** |
| R1 | `§2.2 同步模型`| 提议不可变快照替换读写锁 | 🌟 采纳 (升维简化 70%) | 读写锁同步 ➔ Copy-On-Write 原子快照 | **Pivot-Fixed** |
```

### 三重退出与熔断准则 (Convergence & Circuit Breakers)
1. **Clean Pass 正常退出**：子 Agent 给出 `Clean Pass`，或主 Agent 经 `review-vet` 核验后确认《本轮方案待修订清单》为空（所有剩余意见均属假阳性、已被 `Frozen` 或已完成 `Pivot-Fixed`）。
2. **Oscillation Breaker（防振荡熔断）**：若新子 Agent 对账本中已标记为 `Frozen` 或 `Fixed` 的章节提出相反方向的修改要求（如要求把内存 `Map` 改回外部持久化引擎），主 Agent 直接熔断跳过该条，将其列入最终报告的《需人工确认事项》。
3. **Max Rounds Breaker（最大轮次硬上限）**：硬上限 **`MAX_ROUNDS = 3`**。第 3 轮修订结束后无论是否仍有非阻断分歧，强制退出循环并汇总呈报人类裁决。
