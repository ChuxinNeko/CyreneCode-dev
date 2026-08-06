import { useParams } from "@solidjs/router"
import { createSignal } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

// 模块级状态：控制全屏设置页面显示。useSettingsDialog 触发打开，
// NewLayout 通过 useSettingsPage 消费并渲染 SettingsPage。
type SettingsPageState = {
  open: boolean
  sessionID?: string
  defaultValue?: string
}

const [settingsPageState, setSettingsPageState] = createSignal<SettingsPageState>({ open: false })

export function useSettingsDialog(defaultValue?: string) {
  const params = useParams<{ id?: string }>()
  return () => {
    setSettingsPageState({ open: true, sessionID: params.id, defaultValue })
  }
}

export function useSettingsPage() {
  return {
    state: settingsPageState,
    close: () => setSettingsPageState((prev) => ({ ...prev, open: false })),
  }
}

export function useSettingsCommand() {
  const command = useCommand()
  const language = useLanguage()
  const show = useSettingsDialog()

  command.register("settings", () => [
    {
      id: "settings.open",
      title: language.t("command.settings.open"),
      category: language.t("command.category.settings"),
      keybind: "mod+comma",
      onSelect: show,
    },
  ])

  return show
}
