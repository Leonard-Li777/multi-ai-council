---
name: model-source-sync
description: 自动化嗅探 HuggingFace 与 ModelScope 模型权重及卫星伴随文件（mmproj、DSpark、草稿模型）体积并同步至 model-source.ts。支持零下载网络嗅探、跨仓库 URL 分项解析、全库字段合规审计与多语种配置联动生成。Use when 需要更新或录入模型配置、网络探测模型大小、修复 model-source.ts 缺失体积字段、或用户提及 "model-sync", "模型源同步", "嗅探模型大小", "model-source.ts"。
---

# 模型源网络嗅探与配置同步 (Model Source Sync)

本技能提供零下载权重的远程网络 API / HTTP HEAD 嗅探能力，自动探测主模型及其伴随卫星模型（`mmproj` 视觉投影器、`dspark` 投机加速模型、`draft` 草稿模型）的文件大小，按最新规范生成或修补 `apps/desktop/src/electron/config/model-source.ts`，并自动联动 `generate-extra-configs.js` 生成 10 语种配置。

---

## 1. 快速入门

### 1.1 单 URL 快速嗅探（不写入）

```bash
node scripts/sync-model-source.js https://huggingface.co/saidutta69/LFM3-VL-2B-heretic/blob/main/LFM3-VL-2B-heretic-Q4_K_M.gguf
```

### 1.2 嗅探并直接写入更新配置

```bash
node scripts/sync-model-source.js https://huggingface.co/saidutta69/LFM3-VL-2B-heretic/blob/main/LFM3-VL-2B-heretic-Q4_K_M.gguf --update
```

> **注意**：附加 `--update` 时，脚本会自动修改 `model-source.ts` 并自动执行多语言流水线 `node scripts/generate-extra-configs.js` 双写 10 语种 JSON。

---

## 2. 跨仓库 / 分项 URL 独立解析

当投影器、DSpark 或 Draft 草稿模型与主模型不在同一仓库或页面时，支持分别传入独立 URL：

```bash
node scripts/sync-model-source.js \
  --main https://huggingface.co/NicklausCairns/gemma-4-E2B-it-qat-GGUF/blob/main/gemma-4-E2B-it-qat-Q4_K_M.gguf \
  --draft https://huggingface.co/NicklausCairns/gemma-4-E2B-it-qat-assistant-MTP-Q8_0/blob/main/assistant.gguf \
  --update
```

或指定外部 mmproj 投影模型：

```bash
node scripts/sync-model-source.js \
  --main https://modelscope.cn/models/unsloth/Qwen3.8-27B-GGUF/file/view/master/Qwen3.8-27B-UD-Q4_K_M.gguf \
  --mmproj https://modelscope.cn/models/unsloth/Qwen3.8-27B-GGUF/file/view/master/mmproj-F16.gguf \
  --update
```

---

## 3. 全库合规审计与一键修复

### 3.1 审计缺失分项体积的模型

```bash
node scripts/sync-model-source.js --audit
```

检查 `model-source.ts` 中是否存在缺失 `modelSize`、`mmprojSize`、`dsparkSize` 或 `draftSize` 的历史条目。

### 3.2 一键联网嗅探并修复全部不合规条目

```bash
node scripts/sync-model-source.js --fix-all
```

自动遍历所有未达标模型，请求对应平台的最新文件树与体积信息，批量回写并触发 10 语种双写与公差校验。

---

## 4. 参数字典

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `[URL]` | 默认首参，等同于 `--main <URL>` | `https://huggingface.co/...` |
| `--main <URL>` | 主模型下载链接（HuggingFace / ModelScope） | `--main https://...` |
| `--mmproj <URL>` | 独立视觉投影器链接（跨仓库匹配） | `--mmproj https://...` |
| `--dspark <URL>` | 独立 DSpark 投机加速模型链接 | `--dspark https://...` |
| `--draft <URL>` | 独立 Draft 草稿模型链接 | `--draft https://...` |
| `--update` | 将嗅探结果直接持久化至 `model-source.ts` 并自动生成多语种 JSON | `--update` |
| `--audit` | 检查并列出所有缺少细分体积字段的模型条目 | `--audit` |
| `--fix-all` | 自动针对审计不合格的所有条目联网批量嗅探并修复 | `--fix-all` |
| `--dry-run` | 仅打印更新代码差异，不写入物理文件 | `--dry-run` |
| `--name <string>` | 自定义模型展示名（默认按仓库/量化自动推导） | `--name "MiniCPM-V 4.6"` |
| `--level <1-5>` | 设置智能等级（默认 3） | `--level 4` |
| `--ctx <number>` | 设置上下文长度（默认 131072） | `--ctx 65536` |

---

## 5. 核心规范与业务不变量

1. **零下载原则**：仅调用 HuggingFace/ModelScope 官方元数据 Tree API 或 HTTP HEAD/Range 请求提取文件大小，严禁拉取模型本体二进制切片。
2. **纯 JS/TS 兼容**：`model-source.ts` 函数体内**严禁携带 TypeScript 类型注解**（确保 Node.js CJS / ESM 能直接执行 `require` / `import`）。
3. **免机翻交付**：写入中文基线配置后，由 `node scripts/generate-extra-configs.js` 统一翻译至 10 语种并验证公差门禁。
