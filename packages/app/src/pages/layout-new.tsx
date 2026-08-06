import { createEffect, lazy, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { AppSidebar } from "@/components/app-sidebar"
import { useSettingsPage } from "@/components/settings-dialog"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"

// 懒加载全屏设置页面，保持 settings-v2 及其依赖不进入主 chunk。
const SettingsPage = lazy(() =>
  import("@/components/settings-v2").then((m) => ({ default: m.SettingsPage })),
)

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const settingsPage = useSettingsPage()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="flex-1 min-h-0 min-w-0 flex flex-row">
        <Show
          when={settingsPage.state().open}
          fallback={
            <>
              <AppSidebar />
              <main class="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col items-start bg-v2-background-bg-deep contain-strict">
                <Suspense>{props.children}</Suspense>
              </main>
            </>
          }
        >
          <Suspense>
            <SettingsPage
              sessionID={settingsPage.state().sessionID}
              defaultValue={settingsPage.state().defaultValue}
              onBack={settingsPage.close}
            />
          </Suspense>
        </Show>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
