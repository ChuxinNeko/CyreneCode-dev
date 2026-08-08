# NekoCode

> 一个基于 Electron 的 AI Agent 桌面客户端，派生自 [opencode](https://opencode.ai) 的 monorepo。

NekoCode 把 opencode 的 Agent 引擎封装成原生桌面应用，在保留完整 Agent 能力的同时，加入了模型智能路由、桌面宠物等个性化能力。

## 特性

- **桌面原生体验**：基于 Electron + SolidJS，支持 Mica 材质、窗口控制、多标签页、系统托盘。
- **智能模型路由（ModelRouter）**：按轮次自动为会话选择合适档位的模型（S / M / L / XL），支持 `observe` / `full` 两种模式、预算上限（warn / cap）、困难度与风险启发式分类。
- **多 Provider**：内置 Anthropic、OpenAI、Google、xAI、Groq、Mistral、Perplexity、Azure、AWS Bedrock、OpenRouter、自定义（OpenAI 兼容）等大量模型接入。
- **MCP 支持**：挂载 Model Context Protocol 服务器，扩展 Agent 可用的工具。
- **多协议兼容**：同时支持 v1 / v2 服务端协议，可连接本地与远程服务端。
- **桌面宠物**：内置 Taffy、小昔泓、月薪喵三只宠物，随 Agent 运行状态播放动画。
- **多语言**：i18n 支持英文 / 简体中文 / 繁体中文。
- **完整 Agent 工具链**：终端（PTY）、文件树、代码搜索（ripgrep）、Git 操作、多文件编辑、计划与应用模式、权限审批。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 桌面框架 | Electron + electron-vite |
| 前端 | SolidJS + Solid Router + Tailwind CSS v4 |
| 后端运行时 | Bun（`#bun` 条件导入区分 Node / Bun） |
| 函数式核心 | Effect（v4 beta）+ Drizzle ORM + SQLite |
| AI 接入 | Vercel AI SDK（`@ai-sdk/*`） |
| 包管理 | Bun workspaces + Turbo（monorepo） |

## 快速开始

### 环境要求

- [Bun](https://bun.sh) ≥ 1.3
- Node.js ≥ 22（可选，用于部分平台插件）

### 安装依赖

```bash
bun install
```

### 启动桌面应用

```bash
bun dev:desktop
```

### 启动 Web 版（仅前端）

```bash
bun dev:web
```

## 构建与打包

```bash
# 构建 JS 资源
bun run build

# 打包为桌面应用（产物在 dist/）
bun run package
```

按平台打包：

```bash
bun --cwd packages/desktop run package:win     # Windows
bun --cwd packages/desktop run package:mac     # macOS
bun --cwd packages/desktop run package:linux   # Linux
```

## 开发

```bash
# 类型检查
bun turbo typecheck

# Lint
bun lint

# 测试（core）
bun --cwd packages/core run test
```

## 目录结构

```
packages/
  app/            # 前端应用（SolidJS 单页应用）
  desktop/        # Electron 壳（主进程 / preload / 渲染进程）
  core/           # Agent 核心引擎（会话、模型、工具、配置、数据库）
  opencode/       # 服务端 / CLI 入口
  llm/            # 模型层封装
  codemode/       # 代码模式（计划 / 应用）
  plugin/         # 插件系统
  schema/         # 数据模型与协议模式
  sdk/            # 客户端 SDK 与 OpenAPI 生成代码
  server/         # HTTP 服务端
  tui/            # 终端 UI
  session-ui/     # 会话 UI 组件
  ui/             # 通用 UI 组件与主题
  pet/            # 桌面宠物资源（Taffy / 小昔泓 / 月薪喵）
```

## 配置

NekoCode 沿用 opencode 的配置体系，核心配置位于 `packages/core/src/config/`，包括：

- `agent.ts` — Agent 行为与工具权限
- `provider.ts` — 模型提供商与凭据
- `mcp.ts` — MCP 服务器
- `router.ts` — 模型路由（档位映射、预算、深度阈值）
- `plugin.ts` — 插件

智能路由配置示例（`opencode.json`）：

```jsonc
{
  "router": {
    "enabled": true,
    "mode": "observe", // observe 只记录，full 才实际切换模型
    "tiers": {
      "S": "openai/gpt-4o-mini",
      "M": "anthropic/claude-sonnet-4-5",
      "L": "anthropic/claude-opus-4-1"
    },
    "budget": {
      "limitUsd": 10,
      "action": "warn" // warn 或 cap
    }
  }
}
```

## 许可

本项目遵循 MIT 许可。

> 本项目派生自 [opencode](https://github.com/sst/opencode)（MIT 许可）。NekoCode 是独立维护的衍生品，与 opencode 官方无关。