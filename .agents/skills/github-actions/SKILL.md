---
name: github-actions
description: 管理 GitHub Actions 流水线。查询状态、提取错误日志、诊断修复、触发构建、清理历史。Use when user mentions GitHub Actions, CI/CD, 流水线, workflow, build failure, 或需要操作 firefly-ai-folder 及其子模块的 CI 流水线时。
---

# GitHub Actions 管理

管理 firefly-ai-folder monorepo 中所有仓库的 GitHub Actions 流水线。

## 快速开始

```bash
# 交互模式（完整 3 级菜单）
pnpm run ci

# Agent 模式（已知参数跳过对应菜单层级）
pnpm run ci -- --repo <repo> --workflow <file> --action <action>
```

## 仓库映射

| 标识 | 仓库 | Workflows |
|------|------|-----------|
| `firefly-ai-folder` | Leonard-Li777/firefly-ai-folder | `build-cross-platform.yml`, `deploy-marketing.yml` |
| `desktop` | Leonard-Li777/firefly-ai-folder-desktop | `firefly-ai-folder-desktop-release.yml`, `e2e-release-test.yml`, `verify-releases.yml` |
| `firefly-resources` | Leonard-Li777/firefly-resources | `publish-resources.yml` |
| `omni` | Leonard-Li777/firefly-omni | `omni-ce-release.yml`, `omni-libmupdf-build.yml`, `omni-pro-release.yml` |

## 操作

| 操作 | `--action` 参数 | 说明 |
|------|----------------|------|
| 流水线状态 | `status` | 显示最近运行的状态、耗时、提交信息 |
| 最新流水线错误内容 | `errors` | 提取最新失败 run 的错误日志及上下文 |
| 诊断并修复流水线错误 | `diagnose` | 提取错误 + 分析根因 + 生成修复建议（JSON 输出） |
| 诊断并修复并触发流水线 | `diagnose-trigger` | 同上 + 自动触发 workflow_dispatch |
| 删除流水线历史 | `cleanup` | 支持 auto（清理失败/取消）和 custom（交互选择） |

## Agent 使用指南

1. 若上下文已包含仓库和 workflow 信息，直接传参：`pnpm run ci -- --repo desktop --workflow firefly-ai-folder-desktop-release.yml --action status`
2. 若信息不明确，用 `pnpm run ci` 启动交互菜单，由用户选择
3. `diagnose` 输出 JSON 格式，可直接解析用于后续修复操作
4. 修复代码后用 `diagnose-trigger` 或手动触发重新构建验证

## 输出格式

### `diagnose` 和 `errors` 操作

输出结构化 JSON：

```json
{
  "repo": "desktop",
  "workflow": "firefly-ai-folder-desktop-release.yml",
  "runId": 12345,
  "runNumber": 42,
  "status": "failure",
  "failedJobs": [
    {
      "name": "build-windows",
      "id": 67890,
      "errors": [
        {
          "line": 142,
          "content": "Error: Cannot find module '@firefly/core-engine'",
          "context": "..."
        }
      ]
    }
  ]
}
```

### `diagnose-trigger` 操作

触发后额外输出新运行记录的可点击链接：

```json
{
  "repo": "firefly-ai-folder",
  "workflow": "deploy-marketing.yml",
  "status": "failure",
  "triggered": true,
  "newRunId": 33758500000,
  "newRunNumber": 4,
  "runUrl": "https://github.com/Leonard-Li777/firefly-ai-folder/actions/runs/33758500000"
}
```

控制台输出示例：
```
🔗 新运行记录已创建：
   📋 Run #4 (ID: 33758500000)
   🌐 点击查看: https://github.com/Leonard-Li777/firefly-ai-folder/actions/runs/33758500000
```
