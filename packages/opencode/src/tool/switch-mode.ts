import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { MessageID, PartID } from "../session/schema"
import SWITCH_MODE_DESCRIPTION from "./switch-mode.txt"

export const Parameters = Schema.Struct({
  target_mode_id: Schema.String.annotate({
    description: "要切换到的目标模式。目前仅允许 'plan'。",
  }),
  explanation: Schema.optional(Schema.String).annotate({
    description: "简短说明为什么要切换到 plan 模式，便于用户理解。",
  }),
})

// 可调用 switch_mode 切到 plan 的源模式（plan 自身与 subagent 不可调用）。
export const SWITCHABLE_MODES = ["ask", "agent", "debug", "multitask"] as const

type Metadata = {
  from?: string
  to?: string
}

export const SwitchModeTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "switch_mode",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: SWITCH_MODE_DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const target = params.target_mode_id?.trim().toLowerCase()
          if (target !== "plan") {
            return {
              title: "不支持的模式切换",
              output: `仅支持切换到 plan 模式，收到 "${params.target_mode_id}"。当前会话保持原模式不变。`,
              metadata: {},
            }
          }

          // 已在 plan 模式则无需切换
          if (ctx.agent === "plan") {
            return {
              title: "已在 plan 模式",
              output: "当前会话已处于 plan 模式，无需切换。",
              metadata: {},
            }
          }

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          if (!lastUser || lastUser.info.role !== "user" || !lastUser.info.model) {
            return {
              title: "切换失败",
              output: "未找到带模型的用户消息，无法切换模式。",
              metadata: {},
            }
          }
          const userModel = lastUser.info.model
          const explanation = params.explanation?.trim()

          // 更新会话 agent，使前端模式下拉同步显示 plan
          yield* session.setAgentModel({
            sessionID: ctx.sessionID,
            agent: "plan",
            model: {
              id: userModel.modelID,
              providerID: userModel.providerID,
              variant: userModel.variant ?? "default",
            },
            time: Date.now(),
          })

          // 写一条 agent:"plan" 的合成用户消息，下一轮 loop 自动以 plan agent 处理原始需求
          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model: userModel,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `已自动切换到 Plan 模式${explanation ? `：${explanation}` : ""}。请基于上述对话中的用户原始需求，制定实现计划。`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "已切换到 plan 模式",
            output: `已自动切换到 Plan 模式${explanation ? `（${explanation}）` : ""}。Plan agent 将接管并制定计划，请结束当前回合。`,
            metadata: { from: ctx.agent, to: "plan" },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
