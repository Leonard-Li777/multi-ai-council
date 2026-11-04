# Multi-AI Council 系统总纲 (L1 Kernel)

Multi-AI Council 是一个基于 Chrome Extension MV3 的多模型协作工作台，支持会话分发、流式监听、延伸判定与终审提炼。

## 核心契约与不变性
1. **持久化状态机事实源**：以 `chrome.storage.session` + IndexedDB 为唯一事实源，SW 30s 回收后必须幂等恢复。
2. **Side Panel 主控**：以 Side Panel 为 UI 编排入口与 Window 宿主，维持长连接与心跳。
3. **安全与合规边界**：严禁暴力绕过 Cloudflare 验证码；仅操作用户当前登录会话；本地存储使用 IndexedDB 并经 DOMPurify 过滤。
4. **包管理与开发规范**：使用 `pnpm`；核心逻辑覆盖单元测试与类型全绿。

## 架构导航 (L2 Hubs)
- [系统架构与工程规范](docs/developer/standards/architecture.md)
