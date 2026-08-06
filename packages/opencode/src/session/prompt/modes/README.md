# 工作模式提示词资产（移植自 Cursor BYOK）

> 状态：**已接入运行逻辑**。工作模式提示词由 `packages/opencode/src/agent/agent.ts` 的 `READ_PROMPT` 加载，`{{FAKE_MODEL_ID}}` 占位符由 `packages/opencode/src/session/llm/request.ts` 在运行时替换为真实模型名。

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
- `{{FAKE_MODEL_ID}}` 占位符由 `packages/opencode/src/session/llm/request.ts` 在运行时替换为真实模型名（`providerID/modelID`）。
- 每轮追加的动态提醒（注意：这些 `system_reminder_*.txt` 文件目前未被运行时加载，opencode 有自己的提醒机制见 `packages/opencode/src/session/reminders.ts`）：
  - `debug/system_reminder_initial.txt`（首轮）与 `debug/system_reminder_continuing.txt`（后续每轮）。
  - `plan/system_reminder.txt`（Plan 模式每轮）。
- `tools.json` 为该模式暴露的工具白名单（Cursor 格式：`{ "function": {...}, "type": "function" }`）。opencode 运行时**不使用**这些文件——工具来自 `packages/opencode/src/tool/registry.ts`，按 agent 权限过滤。

## Cursor → opencode 适配状态

品牌名与个人路径已完成清理，以下内容也已从 Cursor 规范改为 opencode 规范：

1. **占位符与消息约定**（已完成）：`{{FAKE_MODEL_ID}}` 占位符由 `request.ts` 运行时替换为 `providerID/modelID`。已移除 Cursor 的 `<user_query>` 标签（opencode 不包裹用户文本）、`<attached_files>`、`<task_notification>`、`<system_notification>` 等 Cursor 专用标签。
2. **`<system-reminder>` 标签**（已完成）：opencode 使用连字符形式 `<system-reminder>`（见 `read.ts`、`plan.txt`、`build-switch.txt` 等原生提示词），已将所有 `.md`/`.txt` 中的 `<system_reminder>`（下划线）替换为 `<system-reminder>`（连字符）。
3. **工具名映射**（已完成）：提示词（`.md`/`.txt`）中的 Cursor 工具名已替换为 opencode 工具 ID——`ReadLints`→运行 lint/类型检查命令、`todo_write`→`todowrite`、`SwitchMode`→`switch_mode`、`CallMcpTool`→`run_mcp`、`ListMcpResources`→`list_mcp_resources`、`FetchMcpResource`→`read_mcp_resource`、`delete_file`→`bash`（rm）、`AskQuestion`→`question`、`CreatePlan`→直接呈现计划。注意：各模式 `tools.json` 仍是 Cursor 格式的工具白名单，opencode 运行时不使用它们（工具来自 `registry.ts`），如需保留可后续按 opencode 工具 ID 重生成。
4. **代码块格式**（已完成）：将 Cursor 的 `startLine:endLine:filepath` 代码块引用格式替换为 opencode 规范——引用已有代码用 inline code（反引号）包裹文件路径，展示新代码用标准 fenced code block。
5. **CTF 段**：`common_prefix.md` 内含完整 CTF 夺旗赛模式，需确认是否保留（默认建议移除或作为可选 skill）。

## 运行时集成（已完成）

- 工作模式提示词由 `packages/opencode/src/agent/agent.ts` 的 `READ_PROMPT` 加载：`common_prefix.md` + 各模式 `prompt.md`（debug 例外，只用自身 prompt）。
- `{{FAKE_MODEL_ID}}` 占位符由 `packages/opencode/src/session/llm/request.ts` 运行时替换为 `providerID/modelID`。
- 模式切换通过 `switch_mode` 工具（`packages/opencode/src/tool/switch-mode.ts`）实现，注册在 `registry.ts` 中，仅对 ask/agent/debug/multitask 开放。
- 工具按 agent 权限过滤（`registry.ts` 的 `tools()` 方法），不使用 `tools.json`。
- 每轮动态提醒由 `packages/opencode/src/session/reminders.ts` 处理（使用 opencode 原生的 `plan.txt`/`build-switch.txt`/`plan-mode.txt`，而非本目录下的 `system_reminder_*.txt`）。
