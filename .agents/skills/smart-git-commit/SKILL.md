---
name: smart-git-commit
description: 智能、快速、高性价比的分批提交与推送工具。优先基于文件名与目录路径进行秒级启发式聚类，仅在遇到疑难孤立文件时按需局部查验 diff；秉持“宁并勿拆、大概OK即行”的敏捷原则，快速生成紧凑批次计划并执行提交与推送。Use when the user wants to commit/push multiple changes at once, group related changes, write meaningful commit messages, or says things like "commit", "push", "分批提交", "批次commit", "提交这几个仓库", or invokes /smart-git-commit.
---

# 智能快速分批提交 (Smart Git Batch Commit)

摒弃无脑全量提取 diff 的过度工程，采用**“路径启发优先 + 疑难按需懒查 diff + 宁并勿拆”**的两级渐进式策略，在保障提交逻辑清晰的前提下，实现秒级归组与极速提交推送。

## 核心流程

```
[git status 列出根仓与子仓全部变动]
       │
       ▼
1. 路径启发式聚类 (Tier 1) ── 根据子仓边界、功能目录、组件配对与扩展名秒级分组 (零 diff 消耗)
       │
       ▼
2. 疑难按需查验 (Tier 2) ──── 仅对 1~2 个看不出意图的跨目录游离文件进行定点微量 diff
       │
       ▼
3. 批次合并与信息推导 ────── 遵循“宁并勿拆、大概OK即行”，按 Conventional Commit 自动推导
       │
       ▼
4. 紧凑确认与快速提交 ────── 一次性输出紧凑计划，用户确认后按依赖顺序提交并执行 push
```

## 执行步骤

### 1. 快速盘点仓库变动 (Inventory)
- 运行 `git status --porcelain` 以及子仓库变动情况（`git submodule foreach --recursive "git status --porcelain"`）。
- 若全局无任何改动，直接简短告知并结束。

### 2. Tier 1：路径启发式秒级聚类 (Path-First Clustering)
**默认不读取任何 diff 内容**，直接按以下规则从路径与文件名完成 80%~90% 的分组：
1. **子仓库边界隔离**：各个子模块（如 `apps/desktop/`、`apps/omni/`）内部的改动独立归属于各自仓库。
2. **功能目录自然聚合**：同一业务目录下的文件（如 `.agents/skills/review-*`、`scripts/text-nsfw-l3/`、`apps/desktop/src/components/xxx/`）直接聚拢为同一批次。
3. **组件与配对绑定**：同名源码、测试、样式、类型（如 `foo.ts` + `foo.test.ts` + `foo.styles.ts`）天然捆绑。
4. **元数据与配置归集**：根目录配置文件、锁文件、文档等归入对应的 `chore` 或 `docs`。

### 3. Tier 2：疑难文件按需局部懒查 (Targeted Lazy Diff)
**严禁全量 diff**！仅当遇到跨目录游离、无法从路径判断意图的少数文件时，才定点运行 `git diff -U1 -- <file>` 查看关键几行：
- 查明关联后直接并入最贴近的已有批次；
- 若确实属于独立孤立修改，才单独立项。

### 4. 批次裁定原则：宁并勿拆 (Lump Over Split)
- **大概 OK 就行**：不追求学术级的过度精细拆分。同一次任务或功能迭代相关的改动，合并为一个 commit。
- **快速推导 Message**：根据目录特征直接推导 Conventional Commit 格式（`<type>(<scope>): <subject>`）：
  - `.agents/skills/` ➔ `feat(skills): ...`
  - `apps/desktop/` ➔ `feat(desktop): ...` / `fix(desktop): ...`
  - `scripts/` ➔ `refactor(scripts): ...` / `chore(scripts): ...`

### 5. 紧凑呈现与执行提交推送 (Commit & Push)
- 一次性向用户呈现紧凑清晰的批次列表（每批一行）：
  ```text
  1. [desktop] apps/desktop/src/xxx (3 files) -> feat(desktop): xxx
  2. [root] .agents/skills/xxx (2 files) -> feat(skills): xxx
  ```
- 确认后严格按依赖顺序提交（子仓库优先，根仓库最后，使用显式 `git add <files>`）。
- 提交成功后自动执行 `git push`（推送到当前跟踪分支，遇冲突或未设置 upstream 时明确提示）。
