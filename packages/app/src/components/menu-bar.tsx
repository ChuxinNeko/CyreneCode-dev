import { For } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"

import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { DESKTOP_MENU, desktopMenuVisible } from "@/desktop-menu"
import { commandDisabled, DesktopMenuItem, rememberFocus, runEntry } from "./windows-app-menu"

/** 顶部文本菜单栏展示的顶层菜单 id（与 Codex 顶栏一致：文件/编辑/视图/帮助）。 */
const MENU_BAR_IDS = ["file", "edit", "view", "help"]

export function MenuBar(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
}) {
  const language = useLanguage()
  const menus = () =>
    DESKTOP_MENU.filter((menu) => MENU_BAR_IDS.includes(menu.id) && desktopMenuVisible(menu, "windows"))

  return (
    <div data-slot="menu-bar" class="flex h-full shrink-0 items-center gap-0.5 px-1.5">
      <For each={menus()}>
        {(menu) => (
          <DropdownMenu gutter={4} modal={false} placement="bottom-start">
            <DropdownMenu.Trigger
              type="button"
              class="h-7 shrink-0 rounded-[6px] px-2.5 text-[13px] leading-none text-v2-text-text-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
              onPointerDown={rememberFocus}
              onKeyDown={rememberFocus}
            >
              {language.t(menu.labelKey)}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="desktop-app-menu">
                <DropdownMenu.Group>
                  {menu.items
                    ?.filter((entry) => desktopMenuVisible(entry, "windows"))
                    .map((entry) =>
                      entry.type === "separator" ? (
                        <DropdownMenu.Separator />
                      ) : (
                        <DesktopMenuItem
                          label={entry.labelKey ? language.t(entry.labelKey) : ""}
                          keybind={entry.command ? props.command.keybind(entry.command) : entry.accelerator?.windows}
                          disabled={entry.command ? commandDisabled(props.command, entry.command) : false}
                          onSelect={() => runEntry(props.platform, props.command, entry)}
                        />
                      ),
                    )}
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        )}
      </For>
    </div>
  )
}