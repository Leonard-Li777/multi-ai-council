# 自闭环编码与审查实战案例 (EXAMPLES)

本文件完整还原了一个基于 `implement-loop` 自动完成初始编码并历经 2 轮审查修复达成 0 缺陷交付的端到端范例。

---

## 场景：实现“文件缩略图并发生成限流器与缓存驱逐”

### 用户输入
> 请基于 Issue #312 实现文件缩略图生成的本地内存 LRU 缓存与并发队列控制。使用 `/implement-loop` 流程。

---

### 流水线实录

#### 第一阶段：启动与编码 (Caveman + Implement)
```text
[Caveman active. Fluff removed.]
Read Issue #312. Task: Thumbnail LRU cache + concurrency limit (max 4 parallel).
Files: `thumbnail-pool.ts`, `thumbnail-lru.ts`, `tests/thumbnail-pool.test.ts`.
Code written. Concurrency queue ok. Types pass. Tests green (6 passed).
Entering Auto Review-Fix Loop. Round 1.
```

---

#### 第二阶段：第 1 轮审查修复循环 (Round 1)

1. **主 Agent 调用 `review-handoff`**：
   - 提取会话记忆，关联 `Issue #312` 与 `docs/features/file-management/task-210-...`；
   - 锁定契约：单机内存管理，不引入外部 Redis 依赖；
   - 生成结构化提示词交付。

2. **派生独立子 Agent 执行 `open-code-review-delegate`**：
   - 子 Agent 运行 `ocr delegate preview` 选定 `thumbnail-pool.ts` 等 3 个文件；
   - 子 Agent 依据提示词背景逐行审查，输出报告：
     ```markdown
     ### OCR 代码审查报告
     1. 【边界隐患】`thumbnail-pool.ts:42`：当生成异常崩溃时，`activeWorkers` 计数器未在 finally 块中递减，可能导致并发槽位永久泄漏卡死。
     2. 【高性价比超纲建议】`thumbnail-lru.ts:18`：当前 LRU 仅按条目数量驱逐。若用户加载 100 张 4K 巨图，内存可能瞬时撑爆。建议增加简单的字节大小估算（`roughByteSize` 阈值 100MB 驱逐），成本仅约 6 行代码。
     ```

3. **主 Agent 调用 `review-vet` 去伪存真**：
   - **意见 1**：✅ **采纳**（真 Bug，确实未在 `finally` 中递减，直接导致死锁）；
   - **意见 2**：✅ **采纳【高 ROI 超纲建议】**（低挂果实，仅 6 行代码，极大提升桌面端防 OOM 稳定性）。

4. **主 Agent 执行修复与回归验证**：
   - 在 `thumbnail-pool.ts` 补充 `try ... finally { this.activeWorkers--; }`；
   - 在 `thumbnail-lru.ts` 补充内存大小累加与驱逐；
   - 运行单测：8 passed。

---

#### 第三阶段：第 2 轮审查验证循环 (Round 2)

1. **主 Agent 重新调用 `review-handoff`**：
   - 更新当前代码变动与已完成的修复点。

2. **派生全新独立子 Agent 再次盲审**：
   - 新子 Agent 执行 `ocr delegate preview`；
   - 深度复查并发槽位释放与 LRU 内存驱逐逻辑；
   - **审查结论**：
     > “Clean Pass. 经对并发异常分支与内存驱逐边界逐行复核，未发现阻断性缺陷或边界隐患，改动完全自洽。”

3. **收敛退出**：
   - 待修改缺陷清零，触发正常收敛退出准则。

---

#### 第四阶段：最终交付报告 (Final Output)

```markdown
### 🏁 Implement-Loop 交付报告

#### 1. 收敛概览
- **初始编码**：完成缩略图并发池 (`thumbnail-pool.ts`) 与内存 LRU 队列 (`thumbnail-lru.ts`)。
- **审查轮次**：共 2 轮（第 1 轮发现并修复 1 处并发泄露隐患 + 顺手落地 1 处防 OOM 内存估算；第 2 轮 Clean Pass 0 缺陷收敛）。

#### 2. 质量门禁状态
- **类型检查 (Typecheck)**：All Pass
- **单元测试 (Vitest)**：8 passed, 0 failed
- **安全与契约核验**：符合单一主库与无外部网络依赖契约

#### 3. 建议人类跟进事项 (Non-blocking Suggestions)
- [ ] 考虑后续为超大 SVG 矢量图渲染单独增加独立进程沙盒（当前 PR 暂未覆盖，已列入后续规划）。
```
