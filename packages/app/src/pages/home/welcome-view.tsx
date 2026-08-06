import { createMemo, createSignal, Show } from "solid-js"
import { StatusPopoverV2 } from "@/components/status-popover"
import { SuggestionCards } from "@/components/suggestion-cards"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useTabs } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { createHomeController } from "@/pages/home/home-controller"
import { displayName, homeProjectDirectories } from "@/pages/layout/helpers"

const WELCOME_CONTENT_WIDTH = "w-full max-w-[720px] px-0"

export function WelcomeView() {
  const home = createHomeController()
  const tabs = useTabs()
  const platform = usePlatform()
  const language = useLanguage()
  const pickDirectory = useDirectoryPicker()
  const [value, setValue] = createSignal("")

  const project = () => home.project.newSession()
  const projectName = createMemo(() => {
    const projectItem = project()
    return projectItem ? displayName(projectItem) : undefined
  })

  const startSession = (prompt: string) => {
    const conn = home.server.focused()
    const directory = project()?.worktree
    if (!conn || !directory) return
    const ctx = home.server.focusedContext()
    ctx?.projects.open(directory)
    ctx?.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory }, prompt)
  }

  const send = () => {
    const text = value().trim()
    if (!text) return
    setValue("")
    startSession(text)
  }

  const chooseProject = () => {
    const conn = home.server.focused()
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: false,
      onSelect: (result) => home.project.add(conn, homeProjectDirectories(result)),
    })
  }

  return (
    <div class="flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* 顶部状态栏 */}
      <div class="flex h-10 shrink-0 items-center justify-end gap-2 px-4">
        <StatusPopoverV2 scope="server" />
        <Show when={platform.version}>
          <span class="text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-muted [font-weight:530]">
            v{platform.version}
          </span>
        </Show>
      </div>

      {/* 中央欢迎区 */}
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-4">
        <CloudIcon />
        <h1 class="text-center text-[40px] font-semibold leading-tight text-v2-text-text-base">
          我们该构建什么？
        </h1>
        <SuggestionCards onSelect={startSession} />
      </div>

      {/* 底部输入面板 */}
      <div class="shrink-0 px-6 pb-8">
        <div class={WELCOME_CONTENT_WIDTH}>
          <button
            type="button"
            data-component="welcome-project-picker"
            class="flex h-8 max-w-full cursor-pointer items-center gap-2 rounded-[8px] bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base focus-visible:outline-none"
            onClick={chooseProject}
          >
            <span aria-hidden="true">📁</span>
            <span class="truncate">{projectName() ?? "选择项目"}</span>
          </button>
          <div class="relative mt-2 rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
            <textarea
              rows={1}
              value={value()}
              placeholder="随心输入"
              class="block max-h-40 min-h-10 w-full resize-none rounded-[10px] bg-transparent py-3 pl-4 pr-14 text-[14px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <button
              type="button"
              data-component="welcome-send"
              class="absolute bottom-2 right-2 flex size-8 cursor-pointer items-center justify-center rounded-full bg-v2-icon-icon-accent text-[15px] leading-none text-white transition-opacity duration-150 ease-in-out hover:opacity-90 disabled:opacity-40 focus-visible:outline-none"
              onClick={send}
              disabled={!value().trim()}
              aria-label={language.t("common.submit")}
            >
              ⬆
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CloudIcon() {
  return (
    <svg width="84" height="56" viewBox="0 0 84 56" fill="none" aria-hidden="true">
      <path
        d="M24 48h42a14 14 0 0 0 2.6-27.7 17.5 17.5 0 0 0-32.9-3.8A12.5 12.5 0 0 0 24 48Z"
        fill="var(--v2-icon-icon-muted)"
      />
    </svg>
  )
}
