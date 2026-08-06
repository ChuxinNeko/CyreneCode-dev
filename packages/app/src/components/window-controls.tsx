import { createMemo, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

/**
 * 自定义窗口控制按钮 [—][□][✕]。仅在 Windows 桌面端渲染（替代原生的 WCO 按钮）。
 * 通过现有 runDesktopMenuAction 复用 main 进程的 window.minimize/toggleMaximize/close handler。
 */
export function WindowControls(props: { counterZoom: () => number }) {
  const platform = usePlatform()
  const language = useLanguage()
  const maximized = createMemo(() => platform.windowMaximized?.() ?? false)

  const base =
    "flex h-full w-[46px] shrink-0 items-center justify-center text-[13px] font-medium text-v2-text-text-muted transition-colors duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"

  return (
    <div data-slot="window-controls" class="flex h-full shrink-0 items-stretch" style={{ zoom: props.counterZoom() }}>
      <button
        type="button"
        class={base}
        onClick={() => void platform.runDesktopMenuAction?.("window.minimize")}
        aria-label={language.t("desktop.menu.minimize")}
      >
        —
      </button>
      <button
        type="button"
        class={base}
        onClick={() => void platform.runDesktopMenuAction?.("window.toggleMaximize")}
        aria-label={language.t("desktop.menu.maximize")}
      >
        <Show when={maximized()} fallback="□">
          ❐
        </Show>
      </button>
      <button
        type="button"
        class={`${base} hover:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_70%,transparent)] hover:text-white`}
        onClick={() => void platform.runDesktopMenuAction?.("window.close")}
        aria-label={language.t("desktop.menu.closeWindow")}
      >
        ✕
      </button>
    </div>
  )
}