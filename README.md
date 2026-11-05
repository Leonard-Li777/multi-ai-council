# Multi-AI Council (多模型协作工作台)

<p align="center">
  <img src="public/icon/128.png" alt="Multi-AI Council Logo" width="80" height="80" />
</p>

<p align="center">
  <strong>基于 Chrome Extension MV3 的多模型会话分发、流式抓取、Quorum 降级与 DeepSeek 匿名终审提炼工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/Leonard-Li777/multi-ai-council/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/Framework-WXT%20MV3-purple.svg" alt="WXT MV3"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19.2-61dafb.svg" alt="React 19"></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/TailwindCSS-v4.0-38bdf8.svg" alt="Tailwind CSS v4"></a>
  <a href="https://vitest.dev/"><img src="https://img.shields.io/badge/Tests-100%25%20Passing-brightgreen.svg" alt="Tests"></a>
</p>

---

## 📖 项目简介 (Overview)

在日常利用 AI 进行方案论证、代码评审与技术选型时，单一模型容易陷入信息茧房或输出偶发幻觉。手动逐个打开各个大模型网页分发、来回切换等待、再人工归纳总结，过程极其繁琐低效。

**Multi-AI Council** 是一款专为高效决策者设计的开源 Chrome 浏览器扩展。它以 Chrome **Side Panel** 作为主控中心，允许用户一键将提示词并发调度至多家主流 AI 网页；实时监听流式生成过程与人机拦截；在满足 Quorum 门槛后，自动将多方回复进行 `Model A~E` 随机匿名化与 Prompt Injection 沙箱隔离，重新投入 **DeepSeek** 进行四层逻辑重构与终审提炼，最终生成高价值的决策报告。

---

## ✨ 核心特性 (Key Features)

### 1. 🌐 全矩阵模型并发调度与自由开关
- **覆盖 7 大主流 AI 平台**：
  - [DeepSeek](https://chat.deepseek.com/)（参赛模型 + 终审裁判）
  - [ChatGPT](https://chatgpt.com/) (ProseMirror 富文本受控组件模拟)
  - [Claude](https://claude.ai/) (Lexical/ProseMirror 状态监听)
  - [Gemini](https://gemini.google.com/) (Google Quill 富文本适配)
  - [通义千问 Qwen](https://chat.qwen.ai/)
  - [文心一言 Wenxin](https://wenxin.baidu.com/)
  - [智谱清言 ChatGLM](https://chatglm.cn/)
- **动态启闭与偏好记忆**：支持在 Side Panel 随时单独勾选开启或关闭任一模型，选择状态持久化记忆。
- **平滑错峰激活 (DispatchHub)**：多站激活引入 1.5~3s 动态随机抖动，杜绝瞬时并发触发站点前端风控。

### 2. 🧠 智能会话延续检测 (Continuation Detector)
- 结合**规则引力集**（代词、补丁词、追问指示词）与 `Intl.Segmenter` **词元重合度算法**。
- 自动判定当前提示词是“前序任务的延伸追问”还是“全新独立主题”。
- 延伸会话自动直达原标签窗口继续多轮对话，新主题自动在新窗口开启全新对话。
- 提供 1 秒极简手动覆盖开关，将最终决策权完全交予用户。

### 3. 🛡️ MV3 双层持久化状态机 (Double-Layer Persistence)
- 彻底解决 Chrome MV3 **Service Worker 30 秒休眠**导致内存任务状态丢失的问题。
- **唯一事实源**：以 `chrome.storage.session` + IndexedDB (`idb`) 为双写持久化介质。
- SW 休眠或重启后，状态机可实现 100% 幂等恢复。
- 长连接心跳保活（10s PING/PONG），稳固 Content Script ↔ Side Panel 链路。

### 4. ⚡ Quorum 快速降级调度与防卡顿机制
- **四信号完成判定**：结合“停止按钮消失 + 发送按钮就绪 + 2s DOM 静默 + 长度稳定”，杜绝网络抖动误判。
- **深度思考剥离**：自动剔除 `<think>` 思考过程块与中文折叠面板，保留纯净 Markdown 核心论点。
- **Quorum 门槛决策**：达到最少就绪站点数（例如 7 站就绪 4 站）后，立即激活一键提前终审能力。
- **异常跳过与 90s 超时防护**：遭遇卡顿或验证码时支持单站一键跳过；超时自动弹窗提供降级终审，杜绝无限期挂起。

### 5. 🎭 Model A~E 随机匿名盲审与终审提炼
- **去伪存真与防偏好**：将就绪的 N 方回复进行 Fisher-Yates 随机打乱，脱敏替换为 `Model A`、`Model B`...，彻底消除 DeepSeek 作为终审裁判对自身品牌或其他品牌的既有偏见。
- **Prompt Injection 数据沙箱隔离**：各方回答作为不可信数据包裹于 XML 沙箱标签中，注入防篡改指令。
- **四层结构化终审要求**：
  1. **提炼共识观点（相同合并）**：合并相同论点并注明支持模型；
  2. **分歧辨析与观点整合（求同存异）**：客观对比冲突技术路线；
  3. **合理聚类与层级重构（观点移动归拢）**：主动将细分细节观点移至上位核心大类，杜绝碎片化；
  4. **事实存疑与盲区提醒**：明确指出疑似幻觉或无依据推论。

### 6. 🔒 终审成果可视化、安全清洗与脱敏导出
- **DOMPurify 过滤**：终审 Markdown 经过 DOMPurify 严密清洗，杜绝任何 XSS 攻击。
- **查看模型真身**：提供一键揭晓开关，直观将 `Model A` 还原为具体模型名称。
- **双格式成果导出**：支持一键复制定稿、一键导出 `.md` 聚合报告与 `.json` 完整任务快照。
- **历史任务抽屉**：本地归档最近历史任务，支持随时调阅复现各方回答与终审定稿。

---

## 🛠️ 技术栈 (Tech Stack)

- **宿主架构**: Chrome Extensions MV3 (Manifest V3)
- **开发框架**: [WXT](https://wxt.dev/) (Next-gen Web Extension Framework)
- **前端核心**: React 19 + TypeScript 5
- **界面样式**: Tailwind CSS v4 + Lucide React
- **持久化存储**: IndexedDB via [idb](https://github.com/jakearchibald/idb) + `chrome.storage.session`
- **安全防护**: [DOMPurify](https://github.com/cure53/DOMPurify)
- **单元测试**: [Vitest](https://vitest.dev/) (100% 覆盖关键核心算法与契约)

---

## 🚀 快速上手 (Getting Started)

### 1. 克隆并安装依赖
```bash
git clone https://github.com/Leonard-Li777/multi-ai-council.git
cd multi-ai-council

# 推荐使用 pnpm
pnpm install
```

### 2. 运行与构建
```bash
# 开发模式（热重载）
pnpm dev

# 运行自动化单元测试
pnpm test

# 生产环境打包
pnpm build
```

### 3. 加载到 Chrome 浏览器
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
2. 开启右上角 **开发者模式 (Developer mode)** 开关。
3. 点击 **加载已解压的扩展程序 (Load unpacked)**。
4. 选择本项目根目录下的打包输出文件夹：
   ```
   multi-ai-council/.output/chrome-mv3
   ```
5. 点击浏览器扩展工具栏上的 **Multi-AI Council** 图标，即可展开侧边栏进行多模型协同审查！

---

## 🌟 相关开源矩阵推荐 (Related Projects by Author)

欢迎体验并 Star 本账号下的其他开源 AI 与系统工具项目：

| 项目名称 | 介绍 | 仓库链接 |
| :--- | :--- | :--- |
| 🗂️ **Firefly AI Folder Desktop** | 专为解决文件散乱、命名混乱、归类困难而设计的智能管理桌面应用。深度集成本地 LLM，自动分析文件内容与提取元数据，多维度虚拟分类。 | [Leonard-Li777/firefly-ai-folder-desktop](https://github.com/Leonard-Li777/firefly-ai-folder-desktop) |
| ⚡ **Firefly Omni** | 通用跨模态文件智能感知、文本提取、元数据解析与感知哈希去重的高性能 Rust 核心引擎。 | [Leonard-Li777/firefly-omni](https://github.com/Leonard-Li777/firefly-omni) |
| 🧠 **Firefly AI Engine** | 专为本地模型设计的高性能端侧离线推理平台与模型管理中心，支持多源模型极速嗅探与本地量化部署。 | [Leonard-Li777/firefly-ai-engine](https://github.com/Leonard-Li777/firefly-ai-engine) |
| 📂 **AI Folder Organize** | 萤核智能文件分类与批量重命名助手。AI 自动打标、文件搜索、进度监控、虚拟目录管理与文件去重。 | [Leonard-Li777/ai-folder-organize](https://github.com/Leonard-Li777/ai-folder-organize) |

---

## 📄 开源许可证 (License)

本项目采用 [MIT 许可证](LICENSE) 开源。欢迎提 Issue、PR 或 Fork 共同打磨演进！
