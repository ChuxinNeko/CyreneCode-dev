# 工作模式提示词资产（移植自 Cursor BYOK）

> 状态：**只移植了提示词资产，尚未接入运行逻辑**。具体工作模式（ask / plan / debug / multitask 等的切换与注入）稍后实现。

## 来源

完整逐字节复刻自 `demo/cursor-byok-main/prompt`（Cursor BYOK 客户端）。

> 已清理：品牌名 `Cursor` → `CyreneCode`；移除 `debug/prompt.md` 中写死的个人路径 `/Users/leokun/.cursor/...` 与两个个人 MCP server（`cursor-ide-browser`、`user-context7`）；移除 `tools.json` 中的 `.cursor-local-assistant-v2` ignore 项；`plan/prompt.md` 的 `.cursor` 检索改为通用表述。

## 目录结构

```
modes/
├── common_prefix.md                          # 共享前缀（角色人格 / git 安全 / CTF 模式）
├── ask/        prompt.md + tools.json        # Ask 模式：只读问答，禁止修改
├── plan/       prompt.md + system_reminder.txt + tools.json   # Plan 模式：规划 + 每轮动态提醒
├── agent/      prompt.md + tools.json        # Agent 模式：默认写代码
├── debug/      prompt.md + system_reminder_initial.txt + system_reminder_continuing.txt + tools.json
├── multitask/  prompt.md + tools.json        # Multitask 模式：协调者，委派 worker
├── subagent/   prompt.md + tools.json        # 子代理只读会话
├── commit/     prompt.md                     # 生成 commit message 专用
├── compaction/ prompt.md                     # 上下文压缩（summary）专用
└── README.md                                 # 本说明
```

> 原始目录中的 `doc.go` / `embed.go` / `render.go`（Go 资产加载/渲染）已删除，拼接规则抄录如下，实现工作模式时用 TS 重写即可。

## 拼接规则（原 Go 实现的行为，已抄录于此）

- `ReadPrompt(mode)` = **`common_prefix.md` + "\n\n" + `<mode>/prompt.md`**，两个例外：
  - `subagent`、`debug` 只使用各自的 `prompt.md`，**不加** `common_prefix.md`。
- `{{FAKE_MODEL_ID}}` 占位符由 `render.go` 在运行时替换为真实模型名（空则替换为"当前请求模型"）。
- 每轮追加的动态提醒：
  - `debug/system_reminder_initial.txt`（首轮）与 `debug/system_reminder_continuing.txt`（后续每轮）。
  - `plan/system_reminder.txt`（Plan 模式每轮）。
- `tools.json` 为该模式暴露的工具白名单（Cursor 格式：`{ "function": {...}, "type": "function" }`）。

## 移植到本工程时需要适配的点（尚未处理）

品牌名与个人路径已完成清理，但以下内容仍绑定 Cursor 环境，接入工作模式时需改写为 CyreneCode / opencode 对应实现：

1. **占位符与消息约定**：各 `prompt.md` 的 `{{FAKE_MODEL_ID}}` 占位符、`<user_query>` 标签、`@` 符号引用等 —— 需映射到本系统的运行时注入方式。
2. **工具名映射**：提示词与 `tools.json` 里仍是 Cursor 工具名（`ReadLints`、`PatchEdit`、`Ls`、`Shell`/`AwaitShell`/`WriteShellStdin`、`todo_write`、`SwitchMode`、`CallMcpTool`、`ListMcpResources` 等）；对应到我们环境为 `Read`/`Edit`/`Write`、`Grep`/`Glob`、`Bash`、TodoWrite、Task 等。接入时需按模式重新生成本项目的工具白名单并替换工具名提及。
3. **CTF 段**：`common_prefix.md` 内含完整 CTF 夺旗赛模式，需确认是否保留（默认建议移除或作为可选 skill）。

## 下一步（实现工作模式时）

- 在 `packages/opencode/src/session/system.ts` 的 `provider()` 分派逻辑旁，新增按模式选择提示词的分派。
- 按上述拼接规则实现：common_prefix + mode prompt（subagent/debug 例外）+ `{{FAKE_MODEL_ID}}` 运行时替换。
- 建立模式状态机（默认 agent；可切换到 ask / plan / debug / multitask），并把每轮动态提醒（plan / debug）注入到对应消息。
- 按模式过滤可用工具（对应 `tools.json`）。
