import { For } from "solid-js"

export type StartupSuggestion = { emoji: string; title: string; prompt: string }

/**
 * 新建会话/欢迎页的四个建议卡片。点击把对应 prompt 交给 onSelect 处理
 * （欢迎页直接开新会话，新建会话页填入输入框并聚焦）。
 */
export const NEW_SESSION_SUGGESTIONS: StartupSuggestion[] = [
  {
    emoji: "📢",
    title: "探索并理解代码",
    prompt: "请探索并理解这个项目的代码，总结它的整体架构、关键模块和核心实现思路。",
  },
  {
    emoji: "🔨",
    title: "构建新功能、应用或工具",
    prompt: "请帮助我构建一个新功能、应用或工具。",
  },
  {
    emoji: "🔄",
    title: "审查代码并提出修改建议",
    prompt: "请审查当前项目的代码，找出存在的问题并给出具体的修改建议。",
  },
  {
    emoji: "🐞",
    title: "修复问题和失败",
    prompt: "请排查并修复当前项目中存在的问题和失败。",
  },
]

export function SuggestionCards(props: { onSelect: (prompt: string) => void }) {
  return (
    <div class="grid w-full max-w-[600px] grid-cols-1 gap-3 sm:grid-cols-2">
      <For each={NEW_SESSION_SUGGESTIONS}>
        {(card) => (
          <button
            type="button"
            data-component="welcome-card"
            class="pointer-events-auto flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] bg-v2-background-bg-base px-4 py-3 text-left shadow-[var(--v2-elevation-raised)] transition-[background-color,box-shadow,transform] duration-150 ease-in-out hover:bg-v2-background-bg-layer-01 hover:shadow-[var(--v2-elevation-raised-hover)] focus-visible:outline-none"
            onClick={() => props.onSelect(card.prompt)}
          >
            <span class="shrink-0 text-xl leading-none" aria-hidden="true">
              {card.emoji}
            </span>
            <span class="min-w-0 text-[14px] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-weight:530]">
              {card.title}
            </span>
          </button>
        )}
      </For>
    </div>
  )
}
