# Issue Tracker: Local Markdown

全系统需求与任务全部在本地 Markdown 目录物理落盘，严禁上传 GitHub。

## 目录与拓扑规约 (Directory Conventions)

- **产品需求文档 (PRD)**: `docs/prd/<NNNN>-<feature-slug>-prd.md`（L3 深度规格，前 60 行包含 TOC 锚点）
- **技术规格书 (Spec)**: `docs/specs/<feature-slug>-spec.md`（L3 深度规格，前 60 行包含 TOC 锚点）
- **实现任务工单 (Issues / Tickets)**: `docs/issues/<feature-slug>/<NN>-<slug>.md`（L4 语境历史，从 `01` 开始顺序编号）
- **全景总览 (Map / Overview)**: `docs/issues/<feature-slug>/00-overview.md`
- **任务状态**: 在工单顶部注明 `Status: ready-for-agent` / `claimed` / `completed`

## 操作约定 (Conventions)

### 当技能提及 "publish to the issue tracker"
- 根据文档类型分别写入 `docs/prd/`、`docs/specs/` 或 `docs/issues/<feature-slug>/`，严禁放在 `/docs` 根目录。

### 当技能提及 "fetch the relevant ticket"
- 直接使用 `view_file` 读取指定的本地 Markdown 文件。

### 寻路与工单阻塞操作 (Wayfinding & Blocking)
- **阻塞声明**: 在工单顶部标注 `Blocked by: [01-xxx.md](./01-xxx.md)`；
- **可用前沿 (Frontier)**: 扫描 `docs/issues/<feature-slug>/` 下前置依赖均已标记完成的工单；
- **认领与完成**: 更新工单内部状态并勾选验收准则 `[x]`。
