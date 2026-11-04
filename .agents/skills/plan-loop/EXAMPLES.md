# 方案多轮审查与自闭环打磨实战案例 (EXAMPLES)

本文件展示在编码前通过 `plan-loop` 自动发现方案致命漏洞、对齐契约、探索升维更优范式并原地打磨文档的完整端到端演练过程。

---

## 场景：设计“智能标签多语言别名实时检索与持久化”方案

### 初始输入
开发者与 AI 讨论后，由 `/to-spec` 产出了初版设计草案 `docs/specs/tag-aliases-spec.md`。此时尚未写任何代码。用户运行 `/plan-loop docs/specs/tag-aliases-spec.md` 开始打磨。

---

### 流水线实录

#### 第一阶段：启动与上下文锚定 (Caveman + Target Lock)
```text
[Caveman active. Fluff removed.]
Target: `docs/specs/tag-aliases-spec.md`.
Read spec draft + AGENTS.md database invariants.
Entering Plan Review-Refine Loop. Round 1.
```

---

#### 第二阶段：第 1 轮红队方案审查与修订 (Round 1)

1. **主 Agent 提取上下文并派生独立子 Agent**：
   - 目标：将 Spec 全文、项目硬契约、业务目标与账本打包交由独立子 Agent 盲审。

2. **独立红队子 Agent 基于「六维方案雷达」审查 Plan**：
   - 深入代码库核实签名与数据表事实；
   - 扫描物理可行性、硬契约、KISS、异常兜底、量化 AC 与升维更优解空间，输出报告：
   ```markdown
   ### 红队六维方案审查报告 (Round 1)
   1. [Critical] `docs/specs/tag-aliases-spec.md:42` [维度二: 契约冲突]:
      方案提出新增 `0002_add_aliases.sql` 迁移脚本。严重违背 AGENTS.md（应用未正式上线，直接修改 GENESIS_V1_SCHEMA 创世基线，严禁迁移脚本）。
   2. [High] `docs/specs/tag-aliases-spec.md:58` [维度三: 过度工程]:
      方案提出启动本地 Redis 实例支持倒排索引。单机 Electron 应用标签数 < 3,000，纯属过度工程，严重膨胀安装包体积。
   3. [Medium] `docs/specs/tag-aliases-spec.md:75` [维度四: 悲观路径缺失]:
      未定义 Omni 引擎崩溃或离线时的别名检索降级时序。
   4. [Medium] `docs/specs/tag-aliases-spec.md:92` [维度五: 验收标准模糊]:
      AC 第 3 条“搜索体验应足够流畅”无法被测试量化，需明确毫秒级耗时指标。
   5. [Paradigm Alternative / 升维更优解提议] [维度六: 升维范式优化]:
      【核心视角】：方案在 §2.2 设计了复杂的多线程 Mutex 读写锁与增量双向同步，试图解决“写 SQLite 后更新内存 Map 的并发幽灵读”。
      【高维替代】：单机桌面标签总数仅数千条（全量内存 < 2MB）。若跳出“加锁增量同步”定势，采用函数式不可变快照 (Copy-On-Write Atomic Swap)，写入后在单线程主控下执行原子引用替换。读操作永远零锁且绝对一致，直接消除 100+ 行并发锁防御代码。
   ```

3. **主 Agent 调用 `review-vet` 去伪存真并原地修订文档**：
   - **裁决**：
     - 4 条局部缺陷切中命脉，100% 采纳；
     - `[Paradigm Alternative]` 升维提议完全符合单机 KISS 原则，且将并发复杂度归零，判定为 `Pivot-Fixed` 并原地重构相应章节。
   - **原地编辑 `docs/specs/tag-aliases-spec.md`**：
     - 将数据库实现改为直接更新 `GENESIS_V1_SCHEMA`，删除所有迁移脚本描述；
     - 采纳升维范式：废弃 Redis 与复杂 Mutex 锁，改为 Copy-On-Write 不可变快照原子替换；
     - 在异常处理章节补齐“Omni 离线时优雅降级为本地纯前缀字符串匹配”的状态机；
     - 将 AC 第 3 条量化为：“单次 1,000 条别名在测试用例下匹配耗时 ≤ 5ms”。
   - **更新防振荡账本**：记录 `0002_add_aliases.sql`（Fixed）、Redis（Frozen 驳回）、COW 快照（Pivot-Fixed 采纳）。

---

#### 第三阶段：第 2 轮红队复核 (Round 2)

1. **派生全新独立子 Agent 复核**：
   - 子 Agent 结合更新后的账本对修订后的 `docs/specs/tag-aliases-spec.md` 进行复核。

2. **子 Agent 输出**：
   ```markdown
   ### 红队六维方案审查报告 (Round 2)
   - 【Clean Pass】方案硬契约合规，过度工程已清除，快照架构极简鲁棒且消灭了锁竞态，异常流降级自洽，验收标准完全量化可测。方案设计已达标，建议放行进入编码。
   ```

3. **收敛退出**：
   - 触发 0 阻断缺陷准则，跳出循环。

---

#### 第四阶段：方案就绪交付报告 (Final Output)

```markdown
### 🏁 Plan-Loop 方案打磨就绪报告

#### 1. 打磨演进总结
- **审查轮次**：共 2 轮（第 1 轮消除 1 处严重契约违背、清除 1 处巨型过度工程、吸纳 1 项升维快照范式、补全 1 处异常降级时序；第 2 轮 Clean Pass 达标）。
- **修订文档**：[`docs/specs/tag-aliases-spec.md`](docs/specs/tag-aliases-spec.md)（已原地更新并保存）。

#### 2. 已消除的核心架构风险与升维收益
- 避免了上线前错误引入 database migrations 带来的返工代价；
- 避免了单机桌面端无谓依赖 Redis 导致的构建失败；
- **升维收益**：采用不可变快照原子替换范式，在写代码前消灭了潜在的读写锁竞态死锁，代码量减少 70%；
- 补齐了离线降级状态机，保障了未连接引擎时的核心可用性。

#### 3. 需人工确认的产品偏好 (Zero Blockers)
- [ ] 别名列表在搜索下拉框中默认展示 5 条还是 8 条（当前预设 5 条，可在 UI 落地时微调）。

---
💡 **下一步行动**：方案已完全就绪且无可挑剔！您可以直接运行 `/implement-loop` 开始高水准自动编码与多轮自闭环测试修复！
```
