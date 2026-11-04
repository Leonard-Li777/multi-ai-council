# 架构与领域规范 (Architecture & Standards)

- **环级归属**: 第 2 环 (L2 Standards & Hubs)
- **关联内核**: [AGENTS.md](../../../AGENTS.md)

---

## 1. 领域架构概览

本项目采用 WXT 现代化浏览器扩展架构（Manifest V3），核心由以下三个物理隔离但紧密协同的子系统构成：

1. **Side Panel 控制台**：作为用户的固定交互主视图，承载 React 状态机与 Port 通信。
2. **Background Service Worker**：作为轻量无状态路由与 Tab Group 调度中枢。
3. **Content Script 适配层**：注入目标 AI 站点，通过 Adapter 模式处理 DOM 拟人化输入、四信号完成检测与流式抓取。

---

## 2. 深度规格说明书挂载 (L3 Specs)

- [Multi-AI Council 深度技术规格书](../../specs/multi-ai-council-spec.md)
