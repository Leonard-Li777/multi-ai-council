# 自闭环编码与审查参考手册 (REFERENCE v2.0)

## 一、子 Agent 派生通信协议 (Zero-Bias & Crash-Safe Protocol)

每一轮审查必须派生**全新无历史包袱的独立子 Agent**。为防止 `ocr` CLI 的 `--background-file` 8000 字符硬上限导致进程 Abort，**盲审背景包直接作为 Prompt 文本注入子 Agent，不再传给 `ocr -B` 参数**。

### 子 Agent 派生 Prompt 标准组装模板
- **Role**: `Independent Cold-Blooded Code Reviewer`
- **Prompt**:
  ```markdown
  [Caveman mode REQUIRED: drop all pleasantries and filler. Keep exact technical substance.]
  请作为冷酷客观的独立代码审查员，使用 open-code-review-delegate 技能对当前工作区改动执行确定性审查。

  【一、阅读纪律】：
  查阅任何参考文档（L2/L3）时，必须先读取前 60 行 TOC 目录，再按行号切片读取，严禁全量读取长文档。

  【二、客观盲审约束包 (来自 review-handoff --blind)】：
  [此处粘贴 ≤3000 字符的 BLIND-REVIEW-PACKET，包含：Spec路径、In-Scope/Non-Goals、九大系统硬契约、待审文件、已冻结的 Frozen Ledger]

  【三、强制执行步骤】：
  1. 运行 `ocr delegate preview --format json` 获取待审文件清单（注意：无需传 -B 参数）；
  2. 运行 `ocr delegate rule --format json <本次任务目标文件...>` 获取静态规则；
  3. 通过 `git diff HEAD -- <file>`（已跟踪文件）或直接读取（未跟踪新文件）逐行审查代码；
  4. 严格忽略【Frozen Ledger】中已冻结的争议项，严禁反复横跳；
  5. 按以下四栏结构输出极简报告（若全部通过，直接输出【Clean Pass】）：
     - 【阻断性缺陷】(Critical/High: 崩溃、死锁、脏写、违反九大系统硬契约)
     - 【边界与健壮性改进】(Medium: 异常吞没、极端输入、资源未释放)
     - 【高性价比超纲建议】(显式标注【超纲】，仅限 ≤5 行代码即可大幅防崩的低挂果实)
     - 【审查覆盖率统计】(reviewed_files / total_files)
  ```

---

## 二、《Loop State Ledger》显式防振荡状态账本规范

主 Agent 必须在多轮循环间维护如下结构化状态账本，作为确定性状态机记忆锚点：

```markdown
| Round | Location (`file:line`) | Issue Summary | Vet Decision | State Transition ($\alpha \rightarrow \beta$) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R1 | `tag-matcher.ts:52` | catch 块未打日志静默返回 `[]` | ✅ 采纳 (违反 §2.9) | `catch{return []}` ➔ `catch(e){logger.warn(...); return []}` | Fixed |
| R1 | `tag-matcher.ts:18` | 建议将 Map 改为 WeakMap | ❌ 驳回 (Key 为 string) | 保持 `Map<string, ...>` | **Frozen** |
```

### 三重安全熔断器 (Circuit Breakers)
1. **Clean Pass 正常收敛**：《本轮待执行修复清单》为空（0 待修项），立即退出循环。
2. **Oscillation Breaker（状态账本振荡熔断）**：当新子 Agent 提出的主张命中账本中的 `Frozen` 项，或要求将 `Fixed` 项从形态 $\beta$ 改回形态 $\alpha$ 时，主 Agent 直接拦截跳过，将其记入最终报告的《人工裁定清单》。
3. **Max Rounds Breaker（最大轮次硬熔断）**：达到 `MAX_ROUNDS = 4` 仍未清零时，强制终止循环，剩余分歧移交人工。
